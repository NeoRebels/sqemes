import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-477 — the version trigger records who wrote a playbook from `prompts.updated_by`. App writes get
 * it from the guard trigger; the MCP server writes with the service key, where auth.uid() is empty, so
 * every MCP path that writes a playbook must name the author itself — or its version is attributed to
 * whoever wrote before. Each path is pinned by name. The trigger itself is proven against a database in
 * tests/isolation/templateVersions.test.ts.
 */
const src = (readFileSync('supabase/functions/mcp-server/index.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryActions.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryToolDefs.ts', 'utf8'));
const mig = readFileSync('supabase/migrations/20261020060000_sqem477_template_versions.sql', 'utf8');
const handler = (tool: string) => {
  const i = src.indexOf(`if (toolName === '${tool}') {`);
  const j = src.indexOf("if (toolName === '", i + 10);
  return src.slice(i, j);
};

describe('SQEM-477 — every MCP write to a playbook names its author', () => {
  it('create_template and import_skill_from_url insert with updated_by', () => {
    for (const tool of ['create_template', 'import_skill_from_url']) {
      const h = handler(tool);
      const insert = h.slice(h.indexOf(".from('prompts')"), h.indexOf('.select(', h.indexOf(".from('prompts')")));
      expect(insert, tool).toMatch(/updated_by:\s+mcpUserId/);
    }
  });
  it('update_template sets it after the "no fields" check, so that check still counts real fields', () => {
    const h = handler('update_template');
    expect(h.indexOf('updates.updated_by = mcpUserId')).toBeGreaterThan(h.indexOf('No fields to update'));
    expect(h.indexOf('updates.updated_by = mcpUserId')).toBeLessThan(h.indexOf('.update(updates)'));
  });
  it('delete_file names it on every playbook it detaches or swaps the file on', () => {
    expect(handler('delete_file')).toMatch(/\.update\(\{ context_file_ids: next, [^}]*updated_by: mcpUserId \}\)/);
  });
  it('⛔ no other MCP write to prompts exists that could forget it', () => {
    const writes = src.match(/\.from\('prompts'\)\s*\.(insert|update|upsert)\(/g) ?? [];
    expect(writes.length).toBe(4);
  });
});

describe('SQEM-477 — the migration', () => {
  it('records by trigger, and only clients get the author from auth.uid()', () => {
    expect(mig).toContain('create trigger record_template_version after insert or update on public.prompts');
    expect(mig).toMatch(/if tg_table_name = 'prompts' then\s+new\.updated_by := auth\.uid\(\);/);
  });
  it('⛔ restoring runs with the caller\'s rights (no SECURITY DEFINER), so RLS decides', () => {
    const fn = mig.slice(mig.indexOf('create or replace function public.restore_template_version'), mig.indexOf('$function$;', mig.indexOf('restore_template_version')));
    expect(fn).not.toMatch(/security definer/i);
  });
  it('⛔ clients may read and delete versions, never write them', () => {
    expect(mig).toContain('revoke all on public.template_versions from anon, authenticated;');
    expect(mig).toContain('grant select, delete on public.template_versions to authenticated;');
    expect(mig).toMatch(/revoke all on function public\.record_template_version\(\) from public, anon, authenticated;/);
  });
});
