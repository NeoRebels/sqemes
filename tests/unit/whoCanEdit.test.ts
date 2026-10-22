import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-473 (b) — the "Who can edit" control and the read-only editor. The rule is enforced by the
 * database (tests/isolation/restrictEdit.test.ts); this pins that both editors SHOW it, so nobody types
 * into a save RLS will refuse, and that the one non-obvious write is right.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const template = read('pages/TemplateEditor.tsx');
const persona = read('pages/PersonaEditor.tsx');
const control = read('components/TemplateAccessControl.tsx');
const api = read('lib/api/editors.ts');

describe('SQEM-473 — both editors key on the edit right', () => {
  for (const [name, src, kind] of [['TemplateEditor', template, 'template'], ['PersonaEditor', persona, 'persona']] as const) {
    it(`${name}: canEdit is the role AND this object's edit right`, () => {
      expect(src).toMatch(/const canEdit = roleCanEdit && (\(isLibrary \|\| editRight\)|editRight);/);
      expect(src).toContain(`fetchEditRights('${kind}'`);
    });
    it(`${name}: says why it is read-only, and whom to ask`, () => {
      expect(src).toMatch(/roleCanEdit && !editRight/);
      expect(src).toMatch(/but not change it\.<\/span>/);
    });
    it(`${name}: "Who can edit" is the edit variant, changeable only by owner or admin`, () => {
      expect(src).toMatch(/variant="edit"[\s\S]{0,1200}readOnly=\{!canManageEditors\}/);
    });
    it(`${name}: ⛔ "only selected people" with nobody ticked still restricts — the owner is written`, () => {
      expect(src).toMatch(/named\.userIds\.length === 0 && named\.groupIds\.length === 0\) \{\s*named\.userIds = \[/);
    });
  }

  it('TemplateEditor: duplicating needs the role only — a copy is a new playbook of your own', () => {
    expect(template).toMatch(/\{id && roleCanEdit && \(\s*<>[\s\S]{0,300}handleDuplicate/);
    expect(template).toMatch(/\{canEdit && \(\s*<button onClick=\{handleDeleteClick\}/);
  });
});

describe('SQEM-473 — the edit variant of the access control', () => {
  it('offers editors only — admins always may and members never do', () => {
    expect(control).toContain("(variant !== 'edit' || m.role === 'editor')");
  });
  it('has no "Only me" and renders read-only as a disabled fieldset', () => {
    expect(control).toContain('{allowPrivate && !isEdit && (');
    expect(control).toContain('<fieldset disabled={readOnly}');
  });
});

describe('SQEM-473 — lib/api/editors.ts', () => {
  it('asks the database rules, not a client copy of them', () => {
    for (const fn of ['can_edit_template', 'can_edit_persona', 'can_manage_template_editors', 'can_manage_persona_editors']) {
      expect(api).toContain(`'${fn}'`);
    }
  });
  it('shows fail-open for editing (RLS still refuses) and fail-closed for managing', () => {
    expect(api).toContain('canEdit: edit.error ? true : edit.data !== false');
    expect(api).toContain('canManage: manage.error ? false : manage.data === true');
  });
});

describe('SQEM-473 — a refused update is said, not crashed on', () => {
  it('updatePrompt and updatePersona notice zero rows', () => {
    expect(read('lib/api/prompts.ts')).toContain("throw new Error('You may use this playbook but not change it.')");
    expect(read('lib/api/personas.ts')).toContain("throw new Error('You may use this persona but not change it.')");
  });
});
