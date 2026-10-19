import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-512 — the set form of the file rule carries the same three clauses as can_access_file, and the
 * uploader clause stays on the row. The behaviour is proven against a database in
 * tests/isolation/fileListSetBased.test.ts; this pins the shape so a later edit cannot drift silently.
 */
const mig = readFileSync('supabase/migrations/20261019140000_sqem512_file_list_set_based.sql', 'utf8');
const fn = mig.slice(mig.indexOf('create or replace function public.accessible_file_ids()'), mig.indexOf('$function$;'));
const policy = mig.slice(mig.indexOf('create policy "workspace_files_select"'), mig.indexOf('-- Self-test'));

describe('SQEM-512 — accessible_file_ids + workspace_files_select', () => {
  it('(a) the uploader is checked ON THE ROW, so an upload with RETURNING sees its own row (SQEM-525)', () => {
    expect(policy).toContain('created_by = (select auth.uid())');
    expect(fn).not.toMatch(/created_by\s*=\s*\(?\s*(select\s+)?auth\.uid/);
  });

  it('(b) a template the caller can access lists it — joined back to a file of the SAME workspace', () => {
    expect(fn).toContain('public.can_access_template(p.id, p.workspace_id, p.created_by)');
    expect(fn).toContain('f.workspace_id = listed.workspace_id');
  });

  it('(c) ownerless, unlisted, caller is admin (SQEM-509)', () => {
    expect(fn).toMatch(/f\.created_by is null[\s\S]*get_user_role\(f\.workspace_id\) = 'admin'[\s\S]*not exists/);
  });

  it('only within the caller\'s own workspaces, and only for authenticated callers', () => {
    expect(fn.match(/get_user_workspace_ids\(\)/g)?.length).toBe(2);
    expect(mig).toMatch(/revoke all on function public\.accessible_file_ids\(\) from public, anon;/);
    expect(mig).toMatch(/grant execute on function public\.accessible_file_ids\(\) to authenticated;/);
  });

  it('can_access_file itself is left alone — the storage policy still checks one object with it', () => {
    expect(mig).not.toMatch(/create or replace function public\.can_access_file/);
    expect(policy).not.toContain('can_access_file');
  });

  it('the migration aborts when the two rules disagree for anyone', () => {
    expect(mig).toMatch(/raise exception 'SQEM-512 self-test/);
  });
});
