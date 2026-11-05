import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runLimited, applyToEditable, bulkSummary, wouldLoseSight } from '../../lib/bulkApply';
import { en, de } from './i18nText';

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
  // SQEM-646 — the access dialog moved out of Templates.tsx so the Personas page shares it.
  const dialog = read('components/BulkAccessModal.tsx');

  it('Playbooks: one "Edit tag" list (SQEM-646) — remove only where a tag is set — and "Access…"', () => {
    expect(templates).toMatch(/onEditTag=\{tag => void handleBulkTag\(tag, tag \? selectedPrompts\.map\(p => p\.id\) : selectedPrompts\.filter\(p => p\.tag\)\.map\(p => p\.id\)\)\}/);
    expect(templates).toMatch(/onAccess=\{canBulkAccess \? \(\) => setBulkAccessOpen\(true\) : undefined\}/);
    expect(templates).toMatch(/<BulkAccessModal[\s\S]{0,160}kind="template"/);
  });

  it('⛔ "Access…" only where the editor offers access at all: Cloud and multi-seat', () => {
    expect(templates).toMatch(/const canBulkAccess = canEdit && !IS_SELF_HOSTED && isMultiSeat\(workspace\);/);
    expect(personas).toMatch(/onAccess=\{!IS_SELF_HOSTED && isMultiSeat\(workspace\) \? \(\) => setBulkAccessOpen\(true\) : undefined\}/);
  });

  it('⛔ no "Only me" in bulk — no allowPrivate, and Apply waits until someone is named', () => {
    expect(dialog).toMatch(/<TemplateAccessControl/);
    expect(dialog).not.toMatch(/allowPrivate/);
    expect(dialog).toMatch(/disabled=\{incomplete\}/);
    expect(dialog).toMatch(/value\.mode === 'restricted' && value\.userIds\.length === 0 && \(value\.groupIds \?\? \[\]\)\.length === 0/);
  });

  it('the dialog says it replaces, and how many items the person would stop seeing', () => {
    expect(dialog).toMatch(/m\.pb_bulk_access_body\(\)/);
    expect(dialog).toMatch(/m\.ps_bulk_access_body\(\)/);
    expect(en.pb_bulk_access_body).toMatch(/^This replaces the current access of every selected playbook you may change/);
    expect(dialog).toMatch(/m\.pb_lose_sight\(\{ count: loseSight \}\)/);
    expect(dialog).toMatch(/m\.ps_lose_sight\(\{ count: loseSight \}\)/);
    expect(JSON.stringify(en.pb_lose_sight)).toMatch(/you will no longer see \{count\}/);
  });

  it('access is written per item through the edit-right check, each with its own owner stripped', () => {
    expect(dialog).toMatch(/ids => fetchCanEditMany\(kind, ids\)/);
    expect(dialog).toMatch(/setTemplateAccess\(id, workspace\.id, accessValueToAccess\(value, owners\.get\(id\) \?\? null\)\)/);
    expect(dialog).toMatch(/setPersonaAccess\(id, workspace\.id, accessValueToPersonaAccess\(value, owners\.get\(id\) \?\? null\)\)/);
  });

  it('Personas: the same tag actions and, since SQEM-646, access — through can_edit_persona', () => {
    expect(personas).toMatch(/fetchCanEditMany\('persona', list\)/);
    expect(personas).toMatch(/onEditTag=\{tag => void bulkSetTag\(tag, tag/);
    expect(personas).toMatch(/<BulkAccessModal[\s\S]{0,160}kind="persona"/);
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

describe('SQEM-646 — "Edit tag" as one list', () => {
  const bar = read('components/ui/BulkActionBar.tsx');

  it('"Remove tag" first, then the tags to set; remove greyed out when no selected item has a tag', () => {
    const list = bar.slice(bar.indexOf('{onEditTag ? ('), bar.indexOf(') : (', bar.indexOf('{onEditTag ? (')));
    expect(list.indexOf('m.bulk_remove_tag_all()')).toBeGreaterThan(list.indexOf('m.bulk_edit_tag()'));
    expect(list.indexOf('m.bulk_remove_tag_all()')).toBeLessThan(list.indexOf('m.bulk_set_tag_group()'));
    expect(list).toMatch(/<option value=\{REMOVE_TAG\} disabled=\{!hasTaggedSelection\}/);
    expect(list).toMatch(/if \(v === REMOVE_TAG\) onEditTag\(null\);/);
    expect(list).toMatch(/e\.target\.value = ''/); // fires and resets, like the old lists
  });

  it('Files keep the add/remove pair (several tags per file)', () => {
    expect(read('pages/Files.tsx')).toMatch(/onAddTag=/);
    expect(read('pages/Files.tsx')).not.toMatch(/onEditTag=/);
  });

  it('texts in both languages', () => {
    for (const k of ['bulk_edit_tag', 'bulk_remove_tag_all', 'bulk_set_tag_group', 'ps_bulk_access_title', 'ps_bulk_access_body', 'ps_bulk_access_hint', 'ps_lose_sight'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
    expect(de.bulk_edit_tag).toBe('Tag bearbeiten');
    expect(de.bulk_remove_tag_all).toBe('Tag entfernen');
  });
});
