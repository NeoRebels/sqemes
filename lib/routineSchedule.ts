/**
 * SQEM-677 — what the Routines page and editor need to say about a schedule, and which routine
 * results are still unread. The database owns the schedule itself (`routine_next_run`, SQEM-675);
 * this only turns `days` and `time_of_day` into words and back.
 *
 * Pure, types-only imports — tested directly (lib/supabase throws at import time without env vars).
 */
import type { ChatSession } from '../types';
import { m, getLocale } from './i18n';

/** 1 = Monday … 7 = Sunday, as in `routines.days` (ISO). */
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const WEEKDAYS = [1, 2, 3, 4, 5] as const;

/** The three ways the editor offers to pick the days. */
export type Rhythm = 'daily' | 'weekdays' | 'custom';

const sorted = (days: readonly number[]) => [...new Set(days)].filter(d => d >= 1 && d <= 7).sort((a, b) => a - b);
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/** The rhythm a stored set of days reads as. */
export function rhythmOf(days: readonly number[]): Rhythm {
  const d = sorted(days);
  if (same(d, ALL_DAYS)) return 'daily';
  if (same(d, WEEKDAYS)) return 'weekdays';
  return 'custom';
}

/** The days to store for a rhythm; `custom` keeps the chosen ones. */
export function daysFor(rhythm: Rhythm, custom: readonly number[]): number[] {
  if (rhythm === 'daily') return [...ALL_DAYS];
  if (rhythm === 'weekdays') return [...WEEKDAYS];
  return sorted(custom);
}

/** "Mo", "Di" … in the app language; 2024-01-01 was a Monday. */
export function dayShort(day: number, locale = getLocale()): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2024, 0, day))).replace(/\.$/, '');
}

/** "08:00" from the database's "08:00:00". */
export function timeShort(timeOfDay: string): string {
  return timeOfDay.slice(0, 5);
}

/**
 * "Mo–Fr um 08:00", "Täglich um 07:30", "Mo, Mi, Fr um 08:00". A run of three or more days in a row
 * becomes a range; anything else is listed.
 */
export function describeSchedule(days: readonly number[], timeOfDay: string, locale = getLocale()): string {
  const time = timeShort(timeOfDay);
  const d = sorted(days);
  if (same(d, ALL_DAYS)) return m.rt_schedule_daily({ time }, { locale });
  const parts: string[] = [];
  for (let i = 0; i < d.length;) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    if (j - i >= 2) parts.push(`${dayShort(d[i], locale)}–${dayShort(d[j], locale)}`);
    else for (let k = i; k <= j; k++) parts.push(dayShort(d[k], locale));
    i = j + 1;
  }
  return m.rt_schedule_days({ days: parts.join(', '), time }, { locale });
}

/** The browser's own zone; UTC when it gives none. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every zone the browser knows, for the picker; the given one stays in the list even if it does not. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch { /* an old browser: only the current zone and UTC */ }
  return [...new Set([current, 'UTC', ...zones])].sort((a, b) => a.localeCompare(b));
}

/** The person's own routine chats nobody has opened yet, newest first. */
export function unseenRoutineChats(sessions: readonly ChatSession[]): ChatSession[] {
  return sessions
    .filter(s => s.isOwner && s.routineId && s.unseen)
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
}

/** Unread results per routine, for the counters on the Routines page. */
export function unseenByRoutine(sessions: readonly ChatSession[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of unseenRoutineChats(sessions)) out.set(s.routineId!, (out.get(s.routineId!) ?? 0) + 1);
  return out;
}

/** "Di., 11. Nov., 08:00" in the person's own clock; the routine runs at its own zone's time. */
export function runTimeLabel(iso: string, locale = getLocale()): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso));
}

/** The line under a routine's name: why it is paused, or when it runs next. */
export function routineStateLine(r: { pausedReason: 'user' | 'failures' | 'credits' | null; nextRunAt: string | null }, locale = getLocale()): { text: string; warn: boolean } {
  if (r.pausedReason === 'failures') return { text: m.rt_state_failures({}, { locale }), warn: true };
  if (r.pausedReason === 'credits') return { text: m.rt_state_credits({}, { locale }), warn: true };
  if (r.pausedReason === 'user') return { text: m.rt_state_paused({}, { locale }), warn: false };
  return { text: r.nextRunAt ? m.rt_state_next({ when: runTimeLabel(r.nextRunAt, locale) }, { locale }) : m.rt_state_paused({}, { locale }), warn: false };
}

/** The provisional limit of active routines per person (SQEM-672; per plan in part 5). */
export const ACTIVE_LIMIT = 5;

/**
 * SQEM-677 — what a stored routine points at that no longer resolves for this person: a deleted
 * playbook or connector, a persona they cannot see any more. The editor drops these on load; kept,
 * they made the database guard refuse the next save with nothing on screen to remove.
 */
export function staleReferences(
  r: { personaId: string | null; playbookIds: string[]; connectorIds: string[] },
  known: { personaIds: string[]; playbookIds: string[]; connectorIds: string[] },
): { personaId: string | null; playbookIds: string[]; connectorIds: string[]; count: number } {
  const personaId = r.personaId && known.personaIds.includes(r.personaId) ? r.personaId : null;
  const playbookIds = r.playbookIds.filter(id => known.playbookIds.includes(id));
  const connectorIds = r.connectorIds.filter(id => known.connectorIds.includes(id));
  const count = (r.personaId && !personaId ? 1 : 0) + (r.playbookIds.length - playbookIds.length) + (r.connectorIds.length - connectorIds.length);
  return { personaId, playbookIds, connectorIds, count };
}

/** "Morgen-Briefing · 10.11.2026" → name and day (`routineChatTitle` writes them joined by " · "). */
export function splitRunTitle(title: string): { name: string; day: string | null } {
  const i = title.lastIndexOf(' · ');
  return i > 0 ? { name: title.slice(0, i), day: title.slice(i + 3) } : { name: title, day: null };
}
