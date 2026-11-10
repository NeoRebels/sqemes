import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rhythmOf, daysFor, describeSchedule, unseenRoutineChats, unseenByRoutine, routineStateLine, timeZoneOptions, staleReferences, splitRunTitle } from '../../lib/routineSchedule';
import { ROUTINE_CLIENT_COLUMNS, routineRow, routineErrorKind } from '../../lib/routineColumns';
import { buildHistory, historySources } from '../../lib/historyItems';
import type { ChatSession } from '../../types';

/** SQEM-677 — the Routines UI (part 4 of SQEM-672). */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const session = (over: Partial<ChatSession>): ChatSession => ({
  id: 's', workspaceId: 'w', userId: 'u', title: 'T', model: 'm', appliedSkillIds: [], visibility: 'private',
  createdAt: '2026-11-10T08:00:00Z', lastActiveAt: '2026-11-10T08:00:00Z', isOwner: true, isGenerating: false,
  pinned: false, unseen: false, ...over,
});

describe('the schedule in words and back', () => {
  it('rhythm ↔ days', () => {
    expect(rhythmOf([1, 2, 3, 4, 5, 6, 7])).toBe('daily');
    expect(rhythmOf([5, 4, 3, 2, 1])).toBe('weekdays');
    expect(rhythmOf([1, 3, 5])).toBe('custom');
    expect(daysFor('weekdays', [7])).toEqual([1, 2, 3, 4, 5]);
    expect(daysFor('custom', [5, 1, 5, 9])).toEqual([1, 5]);
  });

  it('German and English, a run of three or more days as a range', () => {
    expect(describeSchedule([1, 2, 3, 4, 5, 6, 7], '07:30:00', 'de')).toBe('Täglich um 07:30');
    expect(describeSchedule([1, 2, 3, 4, 5], '08:00:00', 'de')).toBe('Mo–Fr um 08:00');
    expect(describeSchedule([1, 3, 5], '08:00:00', 'de')).toBe('Mo, Mi, Fr um 08:00');
    expect(describeSchedule([6, 7], '10:00:00', 'en')).toBe('Sat, Sun at 10:00');
    expect(describeSchedule([1, 2, 3, 4, 5], '08:00', 'en')).toBe('Mon–Fri at 08:00');
  });

  it('why it is paused, or when it runs next', () => {
    expect(routineStateLine({ pausedReason: 'failures', nextRunAt: null }, 'de').warn).toBe(true);
    expect(routineStateLine({ pausedReason: 'credits', nextRunAt: null }, 'en').text).toMatch(/credits/);
    expect(routineStateLine({ pausedReason: 'user', nextRunAt: null }, 'de').text).toBe('Pausiert');
    expect(routineStateLine({ pausedReason: null, nextRunAt: '2026-11-11T07:00:00Z' }, 'de').text).toMatch(/^Nächster Lauf /);
  });

  it('the stored zone stays pickable even when the browser does not know it', () => {
    expect(timeZoneOptions('Mars/Olympus')).toContain('Mars/Olympus');
    expect(timeZoneOptions('Europe/Berlin')).toContain('UTC');
  });
});

describe('unread routine results', () => {
  const list = [
    session({ id: 'a', routineId: 'r1', unseen: true, lastActiveAt: '2026-11-10T07:00:00Z' }),
    session({ id: 'b', routineId: 'r1', unseen: true, lastActiveAt: '2026-11-10T09:00:00Z' }),
    session({ id: 'c', routineId: 'r2', unseen: false }),
    session({ id: 'd', unseen: true }), // not a routine's chat
    session({ id: 'e', routineId: 'r3', unseen: true, isOwner: false }), // a colleague's, via realtime
  ];
  it('own, from a routine, unread, newest first', () => {
    expect(unseenRoutineChats(list).map(s => s.id)).toEqual(['b', 'a']);
    expect([...unseenByRoutine(list)]).toEqual([['r1', 2]]);
  });

  it('History marks them and offers Routines as a source, after sqemes', () => {
    const h = buildHistory(list.filter(s => s.isOwner), []);
    expect(h.find(e => e.id === 'a')).toMatchObject({ source: 'routine', unseen: true });
    expect(h.find(e => e.id === 'd')).toMatchObject({ source: 'sqemes', unseen: false });
    expect(historySources(h).map(s => s.value)).toEqual(['sqemes', 'routine']);
  });
});

describe('what the client writes', () => {
  const migration = read('supabase/migrations/20261109200000_sqem675_routines.sql');
  const granted = (verb: string) => {
    const m = migration.match(new RegExp(`grant ${verb} \\(([^)]*)\\) on public\\.routines to authenticated`));
    return (m?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  };

  it('⛔ the columns are exactly the INSERT grant, and every row key is among them', () => {
    expect([...ROUTINE_CLIENT_COLUMNS].sort()).toEqual(granted('insert').sort());
    const row = routineRow({ name: ' N ', prompt: ' P ', personaId: null, playbookIds: [], connectorIds: [], model: null, webSearch: false, days: [1], timeOfDay: '08:00', timeZone: 'UTC' });
    for (const k of Object.keys(row)) expect(granted('update'), k).toContain(k);
    expect(row.name).toBe('N');
  });

  it('the refusals of routines_guard are told apart', () => {
    expect(routineErrorKind({ message: 'SQEM-675: at most 5 active routines per person', hint: 'routine_limit' })).toBe('limit');
    expect(routineErrorKind({ message: 'SQEM-675: unknown time zone Mars/Olympus' })).toBe('timezone');
    expect(routineErrorKind({ message: 'SQEM-675: connector not found in this workspace' })).toBe('reference');
    expect(routineErrorKind({ message: 'network' })).toBe('other');
    // The texts it matches are the guard's own.
    expect(migration).toMatch(/at most 5 active routines per person' using errcode = 'P0001', hint = 'routine_limit'/);
    expect(migration).toMatch(/unknown time zone %/);
  });
});

describe('wiring', () => {
  it('⛔ the editor never saves the persona\'s connectors — they resolve per run', () => {
    expect(read('pages/RoutineEditor.tsx')).toMatch(/connectorIds: connectorIds\.filter\(c => !viaPersona\.has\(c\)\)/);
  });

  it('SQEM-679 — Routines where the instance can run them: routes and Start card follow routines_available()', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/const routinesOn = useRoutinesAvailable\(!!currentUser\.id\);/);
    for (const path of ['/routines', '/routines/new', '/routines/:id/edit']) {
      expect(app).toContain(`{routinesOn && <Route path="${path}"`);
    }
    expect(read('pages/Dashboard.tsx')).toMatch(/\{routinesOn && <RoutineResultsCard \/>\}/);
  });

  it('opening a routine chat marks it read; the list selects the two columns', () => {
    expect(read('pages/Chat.tsx')).toMatch(/if \(activeSession\?\.unseen && activeSession\.isOwner\) void markChatsSeen\(\[activeSession\.id\]\);/);
    expect(read('lib/api/chatSessions.ts')).toMatch(/is_generating, workspace_id, pinned, routine_id, unseen'\)/);
  });

  it('the Start card shows only while there is something unread', () => {
    expect(read('components/RoutineResultsCard.tsx')).toMatch(/if \(unseen\.length === 0\) return null;/);
  });
});

describe('German', () => {
  it('⛔ "Routinen" in German, never the English plural', () => {
    const de = read('messages/de.json');
    expect(de).not.toMatch(/Routines/);
    expect(JSON.parse(de).nav_routines).toBe('Routinen');
    expect(read('supabase/functions/_shared/routineRun.ts')).toMatch(/unter Arbeiten → Routinen fort/);
  });
});

describe('design pass', () => {
  it('⛔ references that no longer resolve are dropped on load, and counted', () => {
    const r = staleReferences(
      { personaId: 'p-gone', playbookIds: ['a', 'b-gone'], connectorIds: ['c', 'd-gone', 'e-gone'] },
      { personaIds: ['p'], playbookIds: ['a'], connectorIds: ['c'] },
    );
    expect(r).toEqual({ personaId: null, playbookIds: ['a'], connectorIds: ['c'], count: 4 });
    expect(staleReferences({ personaId: 'p', playbookIds: [], connectorIds: [] }, { personaIds: ['p'], playbookIds: [], connectorIds: [] }).count).toBe(0);
  });

  it('the Start card keeps the day apart from the name', () => {
    expect(splitRunTitle('Morgen · Briefing · 10.11.2026')).toEqual({ name: 'Morgen · Briefing', day: '10.11.2026' });
    expect(splitRunTitle('Ohne Datum')).toEqual({ name: 'Ohne Datum', day: null });
  });

  it('the editor asks before losing changes, needs a model, and leads to the first invalid field', () => {
    const src = read('pages/RoutineEditor.tsx');
    expect(src).toMatch(/const leave = \(\) => \{ if \(isDirty\) setConfirmLeave\(true\); else navigate\('\/routines'\); \};/);
    expect(src).toMatch(/<FullScreenExit label=\{m\.rt_back\(\)\} onExit=\{leave\} \/>/);
    expect(src).toMatch(/model: !model,/);
    expect(src).toMatch(/el\?\.focus\(\{ preventScroll: true \}\)/);
    expect(src).toMatch(/'aria-invalid': true, 'aria-describedby': errId\(f\)/);
  });

  it('count badges sit on accent-strong (white on the dark accent was 2.64:1) and are read as text', () => {
    for (const f of ['pages/Routines.tsx', 'components/Sidebar.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/bg-accent-strong text-white/);
      expect(src, f).not.toMatch(/bg-accent text-white/);
      expect(src, f).toMatch(/<span className="sr-only">\{m\.nav_unread\(\{ count \}\)\}<\/span>/);
    }
    expect(read('pages/Routines.tsx')).not.toMatch(/amber-/);
  });

  it('every caller of refreshChatSessions is held to the 30 s', () => {
    expect(read('store/index.tsx')).toMatch(/if \(!wsId \|\| Date\.now\(\) - lastSessionsLoad\.current < 30_000\) return;/);
  });
});
