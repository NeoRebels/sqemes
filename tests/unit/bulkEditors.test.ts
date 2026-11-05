import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { editorsForItem } from '../../lib/bulkEditors';
import { en, de } from './i18nText';

/**
 * SQEM-621 — "Who can edit" for several playbooks or personas at once, with the editor's own rule
 * (SQEM-473) per item, and only where the person may set the list (owner or admin).
 */
describe('SQEM-621 — what is written per item', () => {
  it('anyone who may edit → no rows', () => {
    expect(editorsForItem({ mode: 'everyone', userIds: ['x'], groupIds: ['g'] }, 'owner', 'actor')).toEqual({ userIds: [], groupIds: [] });
  });

  it('selected people and groups → exactly those', () => {
    expect(editorsForItem({ mode: 'restricted', userIds: ['a', 'b'], groupIds: ['g'] }, 'owner', 'actor'))
      .toEqual({ userIds: ['a', 'b'], groupIds: ['g'] });
  });

  it('⛔ nobody selected → that ITEM\'s owner, never "no restriction" (no row would mean unrestricted)', () => {
    expect(editorsForItem({ mode: 'restricted', userIds: [], groupIds: [] }, 'owner-1', 'actor')).toEqual({ userIds: ['owner-1'], groupIds: [] });
    expect(editorsForItem({ mode: 'restricted', userIds: [], groupIds: [] }, 'owner-2', 'actor')).toEqual({ userIds: ['owner-2'], groupIds: [] });
    // an item without a recorded owner falls back to the person applying it, as the editor does
    expect(editorsForItem({ mode: 'restricted', userIds: [] }, null, 'actor')).toEqual({ userIds: ['actor'], groupIds: [] });
  });
});

describe('SQEM-621 — the wiring', () => {
  const modal = readFileSync('components/BulkEditorsModal.tsx', 'utf8');

  it('⛔ checks the right to SET the list (owner or admin), not merely to edit', () => {
    expect(modal).toMatch(/fetchCanManageEditorsMany\(kind, ids\)/);
    expect(modal).not.toMatch(/fetchCanEditMany/);
    const api = readFileSync('lib/api/editors.ts', 'utf8');
    expect(api).toMatch(/'can_manage_template_editors' : 'can_manage_persona_editors'/);
    expect(api).toMatch(/return !error && data === true;/); // fails closed
  });

  it('uses the editor\'s own control and reports through the shared summary', () => {
    expect(modal).toMatch(/<TemplateAccessControl\s+variant="edit"/);
    // its default hint is the ACCESS one; found in the browser on the persona page
    expect(modal).toMatch(/hint=\{kind === 'template' \? m\.bulk_editors_hint_playbook\(\) : m\.bulk_editors_hint_persona\(\)\}/);
    expect(modal).toMatch(/bulkSummary\(outcome, noun, m\.bulk_editors_changed\(\)\)/);
  });

  it('both pages offer it under the editor\'s condition (Cloud, multi-seat)', () => {
    const t = readFileSync('pages/Templates.tsx', 'utf8');
    expect(t).toMatch(/onEditors=\{canBulkAccess \? \(\) => setBulkEditorsOpen\(true\) : undefined\}/);
    expect(t).toMatch(/kind="template"/);
    const p = readFileSync('pages/Personas.tsx', 'utf8');
    expect(p).toMatch(/onEditors=\{!IS_SELF_HOSTED && isMultiSeat\(workspace\) \? \(\) => setBulkEditorsOpen\(true\) : undefined\}/);
    expect(p).toMatch(/kind="persona"/);
  });

  it('texts in both languages', () => {
    for (const k of ['bulk_editors', 'bulk_editors_title', 'bulk_editors_body', 'bulk_editors_owner_only', 'bulk_editors_changed', 'bulk_editors_hint_playbook', 'bulk_editors_hint_persona'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
      expect(de[k]).not.toMatch(/[–—]/);
    }
  });
});
