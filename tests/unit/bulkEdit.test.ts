import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runLimited, applyToEditable, bulkSummary, wouldLoseSight } from '../../lib/bulkApply';
import { en } from './i18nText';

/**
 * SQEM-564 — access for several playbooks at once, one tag for several playbooks or personas.
 * The logic is pure and tested directly; the pages import the store (and lib/supabase), so their wiring
 * is checked at source level.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-564 — runLimited', () => {
  it('keeps the input order and never has more than `limit` in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runLimited([5, 1, 4, 2, 3, 6], 2, async n => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(results.map(r => (r as PromiseFulfilledResult<number>).value)).toEqual([50, 10, 40, 20, 30, 60]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('records a throw as rejected instead of stopping the rest', async () => {
    const results = await runLimited(['a', 'b', 'c'], 4, async x => { if (x === 'b') throw new Error('no'); return x; });
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });
});

describe('SQEM-564 — applyToEditable: ask first, then write', () => {
  it('writes only what may be changed; the rest is skipped, a throw is failed', async () => {
    const written: string[] = [];
    const outcome = await applyToEditable(
      ['p1', 'p2', 'p3', 'p4'],
      async () => new Set(['p1', 'p3', 'p4']),
      async id => { if (id === 'p4') throw new Error('boom'); written.push(id); },
    );
    expect(outcome).toEqual({ changed: ['p1', 'p3'], skipped: ['p2'], failed: ['p4'] });
    expect(written.sort()).toEqual(['p1', 'p3']);
  });

  it('⛔ a playbook it may not change is never written — so a silent RLS no-op cannot count as success', async () => {
    let calls = 0;
    const outcome = await applyToEditable(['x'], async () => new Set(), async () => { calls++; });
    expect(calls).toBe(0);
    expect(outcome.changed).toEqual([]);
    expect(outcome.skipped).toEqual(['x']);
  });
});

describe('SQEM-564 — one summary for the whole action', () => {
  it('names what changed, what was skipped and why', () => {
    expect(bulkSummary({ changed: ['a', 'b'], skipped: ['c'], failed: [] }, 'playbook', 'Access changed'))
      .toEqual({ message: 'Access changed for 2 playbooks · 1 skipped — you may not change it', type: 'success' });
  });
  it('is an error when anything failed, info when nothing could change', () => {
    expect(bulkSummary({ changed: ['a'], skipped: [], failed: ['b'] }, 'persona', 'Tag removed').type).toBe('error');
    expect(bulkSummary({ changed: [], skipped: ['a', 'b'], failed: [] }, 'playbook', 'Access changed'))
      .toEqual({ message: '2 skipped — you may not change them', type: 'info' });
  });
});

describe('SQEM-564 — who loses sight of a restricted playbook', () => {
  const groups = [{ id: 'g1', memberIds: ['me'] }, { id: 'g2', memberIds: ['other'] }];
  const playbooks = [{ createdBy: 'me' }, { createdBy: 'other' }, { createdBy: null }];
  it('counts the playbooks I did not create when I am not named', () => {
    expect(wouldLoseSight(playbooks, 'me', { userIds: ['other'], groupIds: ['g2'] }, groups)).toBe(2);
  });
  it('is zero when I am named directly or through a group', () => {
    expect(wouldLoseSight(playbooks, 'me', { userIds: ['me'], groupIds: [] }, groups)).toBe(0);
    expect(wouldLoseSight(playbooks, 'me', { userIds: [], groupIds: ['g1'] }, groups)).toBe(0);
  });
});

describe('SQEM-564 — the wiring', () => {
  const templates = read('pages/Templates.tsx');
  const personas = read('pages/Personas.tsx');
  const bar = read('components/ui/BulkActionBar.tsx');
  const editors = read('lib/api/editors.ts');

  it('Playbooks: "Set tag", "Remove tag" only for tags the selection carries, and "Access…"', () => {
    expect(templates).toMatch(/addTagLabel=\{m\.bulk_set_tag\(\)\}/);
    expect(en.bulk_set_tag).toBe('Set tag'); // SQEM-605
    expect(templates).toMatch(/onRemoveTag=\{tag => void handleBulkTag\(null, selectedPrompts\.filter\(p => p\.tag === tag\)/);
    expect(templates).toMatch(/onAccess=\{canBulkAccess \? openBulkAccess : undefined\}/);
  });

  it('⛔ "Access…" only where the editor offers access at all: Cloud and multi-seat', () => {
    expect(templates).toMatch(/const canBulkAccess = canEdit && !IS_SELF_HOSTED && isMultiSeat\(workspace\);/);
  });

  it('⛔ no "Only me" in bulk — no allowPrivate, and Apply waits until someone is named', () => {
    // SQEM-604/605 — the dialog is found by its key now; the words live in messages/.
    const dialog = templates.slice(templates.indexOf('m.pb_bulk_access_title({ count: selectedIds.size })'), templates.indexOf('Publish to Marketplace (SQEM-163)'));
    expect(dialog).toMatch(/<TemplateAccessControl/);
    expect(dialog).not.toMatch(/allowPrivate/);
    expect(dialog).toMatch(/disabled=\{bulkAccessIncomplete\}/);
    expect(templates).toMatch(/bulkAccess\.mode === 'restricted'\s*&& bulkAccess\.userIds\.length === 0 && \(bulkAccess\.groupIds \?\? \[\]\)\.length === 0/);
  });

  it('the dialog says it replaces, and how many playbooks the person would stop seeing', () => {
    expect(templates).toMatch(/m\.pb_bulk_access_body\(\)/);
    expect(en.pb_bulk_access_body).toMatch(/^This replaces the current access of every selected playbook you may change/);
    expect(templates).toMatch(/m\.pb_lose_sight\(\{ count: loseSight \}\)/);
    expect(JSON.stringify(en.pb_lose_sight)).toMatch(/you will no longer see \{count\}/);
  });

  it('access is written per playbook through the edit-right check, each with its own owner stripped', () => {
    expect(templates).toMatch(/applyToEditable\(\s*\[\.\.\.byId\.keys\(\)\],\s*ids => fetchCanEditMany\('template', ids\)/);
    expect(templates).toMatch(/accessValueToAccess\(bulkAccess, byId\.get\(id\)\?\.createdBy \|\| null\)/);
  });

  it('Personas: the same tag actions, through can_edit_persona', () => {
    expect(personas).toMatch(/addTagLabel=\{m\.bulk_set_tag\(\)\}/); // SQEM-605
    expect(personas).toMatch(/fetchCanEditMany\('persona', list\)/);
    expect(personas).not.toMatch(/onAccess=/); // by design: no bulk access for personas
  });

  it('the bar keeps "Add tag" for Files and only shows "Access…" when asked to', () => {
    expect(bar).toMatch(/addTagLabel = m\.bulk_add_tag\(\)/);
    expect(en.bulk_add_tag).toBe('Add tag');
    expect(bar).toMatch(/\{onAccess && \(/);
  });

  it('⛔ fetchCanEditMany fails CLOSED — an id it could not check is skipped', () => {
    expect(editors).toMatch(/return !error && data === true;/);
  });
});
