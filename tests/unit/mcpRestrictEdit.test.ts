import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-473 — every MCP write that changes a playbook or persona asks the database whether this person
 * may EDIT it, with the same rule RLS enforces in the app. SQEM-336 was exactly one forgotten tool, so
 * each path is pinned by name. The rule itself is proven against a database in
 * tests/isolation/restrictEdit.test.ts.
 */
const src = (readFileSync('supabase/functions/mcp-server/index.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryActions.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryToolDefs.ts', 'utf8'));
const mig = readFileSync('supabase/migrations/20261019210000_sqem473_restrict_edit.sql', 'utf8');
const handler = (tool: string) => {
  const i = src.indexOf(`if (toolName === '${tool}') {`);
  const j = src.indexOf("if (toolName === '", i + 10);
  return src.slice(i, j);
};

describe('SQEM-473 — MCP writes check the edit right', () => {
  it('update_template and delete_template refuse after the visibility gate', () => {
    for (const tool of ['update_template', 'delete_template']) {
      const h = handler(tool);
      expect(h, tool).toContain("mayEdit('template', templateId)");
      expect(h.indexOf('canAccessTemplate(templateId)'), tool).toBeLessThan(h.indexOf("mayEdit('template'"));
    }
  });

  it('every persona write goes through findPersonaForWrite, which checks the edit right', () => {
    const resolver = src.slice(src.indexOf('const findPersonaForWrite'), src.indexOf("if (toolName === 'create_persona')"));
    expect(resolver).toContain("mayEdit('persona', personaId)");
    for (const tool of ['update_persona', 'delete_persona', 'attach_template', 'detach_template']) {
      expect(handler(tool), tool).toMatch(/findPersonaForWrite\(/);
    }
  });

  it('delete_file checks every referencing playbook before detaching or swapping', () => {
    const h = handler('delete_file');
    expect(h).toContain("mayEdit('template', t.id)");
    expect(h.indexOf("mayEdit('template', t.id)")).toBeLessThan(h.indexOf('// 5. Detach'));
  });

  it('⛔ fails closed, and calls the functions the migration defines', () => {
    const helper = src.slice(src.indexOf('const mayEdit'), src.indexOf('const refuseEdit'));
    expect(helper).toContain('!error && data === true');
    for (const fn of ['template_edit_allowed', 'persona_edit_allowed']) {
      expect(helper).toContain(`'${fn}'`);
      expect(mig).toContain(`create or replace function public.${fn}(`);
    }
  });

  it('⛔ the user-id forms are service-only; clients get the auth.uid() forms', () => {
    expect(mig).toMatch(/revoke all on function public\.template_edit_allowed\(uuid, uuid\) from public, anon, authenticated;/);
    expect(mig).toMatch(/revoke all on function public\.persona_edit_allowed\(uuid, uuid\)\s+from public, anon, authenticated;/);
    expect(mig).toMatch(/revoke all on function public\.file_edit_allowed\(uuid, uuid, uuid\) from public, anon, authenticated;/);
  });

  it('changing who may SEE a playbook needs the edit right (decision 3)', () => {
    const policy = mig.slice(mig.indexOf('create policy template_access_insert'), mig.indexOf('drop policy if exists "template_access_delete"'));
    expect(policy).toContain('public.can_edit_template(template_id)');
    expect(policy).not.toMatch(/get_user_role/);
  });
});
