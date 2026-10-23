import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-509 — every file the MCP server writes carries its creator.
 *
 * The app gets `created_by` from the trigger `guard_client_owned_columns()`, which deliberately skips the
 * service role — and the MCP server writes with the service role. Without the column a file that no
 * template lists any more is visible to nobody (`can_access_file`), so nobody can delete it. A new
 * insert path must not reopen that.
 */
const SRC = (readFileSync('supabase/functions/mcp-server/index.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryActions.ts', 'utf8') + '\n' + readFileSync('supabase/functions/_shared/libraryToolDefs.ts', 'utf8'));

describe('mcp-server writes workspace_files WITH created_by', () => {
  const inserts = [...SRC.matchAll(/\.from\('workspace_files'\)\s*\.insert\(/g)].map(m => {
    const start = m.index!;
    const end = SRC.indexOf('\n      if (', start); // every insert is followed by its error check
    return SRC.slice(start, end > start ? end : start + 1500);
  });

  it('finds the three insert paths (upload_file, finalize_upload, import_skill_from_url)', () => {
    expect(inserts.length).toBe(3);
  });

  it('⛔ each one sets created_by to the key owner', () => {
    for (const body of inserts) expect(body).toMatch(/created_by:\s*mcpUserId/);
  });
});

describe('the migration keeps the admin branch in BOTH places', () => {
  const sql = readFileSync('supabase/migrations/20261013220000_sqem509_file_creator.sql', 'utf8');
  it('can_access_file and library_access_sets carry the same ownerless-orphan rule', () => {
    expect(sql).toMatch(/p_created_by is null\s+and coalesce\(public\.get_user_role\(p_workspace_id\) = 'admin', false\)/);
    expect(sql).toMatch(/f\.created_by is null\s+and exists \(select 1 from public\.workspace_members m/);
  });
  it('⛔ keeps the SQEM-505 membership check and the service-role-only grant', () => {
    expect(sql).toMatch(/p_workspace_id in \(select public\.get_user_workspace_ids\(\)\)/);
    expect(sql).toMatch(/revoke all on function public\.library_access_sets\(uuid, uuid\) from public, anon, authenticated/);
  });
});
