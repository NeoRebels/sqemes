import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-492 — the rights audit. Every table a client writes gets explicit column grants, value checks
 * or a guard trigger. These tests hold the migration and the client write paths together: a grant
 * that misses a column the app sends breaks a save with `permission denied`, and a grant that
 * includes a server-owned column reopens what the audit closed.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments before block comments — see comment-stripper order in source tests.
const code = (src: string) => src
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const sqlCode = (src: string) => src.replace(/--.*$/gm, '');

const SQL = sqlCode(read('supabase/migrations/20260929200000_sqem492_client_write_audit.sql'));

/** Column list of the DO-block that grants on `table` (the array right before its REVOKE). */
const grantList = (table: string, verb: 'UPDATE' | 'INSERT'): string[] => {
  const revoke = SQL.indexOf(`REVOKE ${verb} ON public.${table} FROM anon, authenticated`);
  if (revoke < 0) throw new Error(`no ${verb} revoke for ${table}`);
  const before = SQL.slice(0, revoke);
  const arr = before.slice(before.lastIndexOf('cols text[]'));
  const list = arr.match(/ARRAY\[([^\]]*)\]/);
  if (!list) throw new Error(`no column list for ${table}`);
  return [...list[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
};
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(name);
  if (start < 0) throw new Error(`${name} not found`);
  const next = src.indexOf('\nexport ', start + name.length);
  return src.slice(start, next < 0 ? undefined : next);
};

describe('SQEM-492 — workspace_files', () => {
  it('binds storage_path to the row\'s workspace, for every writer', () => {
    expect(SQL).toMatch(/CHECK \(storage_path LIKE workspace_id::text \|\| '\/%'\)/);
  });

  it('lets the client update only name and tags — exactly what updateWorkspaceFile sends', () => {
    expect(SQL).toMatch(/GRANT UPDATE \(name, tags\) ON public\.workspace_files TO authenticated/);
    const files = code(read('lib/api/files.ts'));
    expect(fnBody(files, 'updateWorkspaceFile')).toMatch(/patch: \{ name\?: string; tags\?: string\[\] \}/);
  });

  it('edge functions never download or remove a path outside the workspace', () => {
    const lq = code(read('supabase/functions/_shared/libraryQueries.ts'));
    const downloads = lq.match(/\.download\([a-z]+\.storage_path\)/g) ?? [];
    expect(downloads.length).toBe(2);
    expect((lq.match(/isPathInWorkspace\(/g) ?? []).length).toBe(2); // one guard per download
    const mcp = code(read('supabase/functions/mcp-server/index.ts'));
    expect(mcp).toMatch(/if \(isPathInWorkspace\(file\.storage_path, workspaceId\)\) \{\s*await adminClient\.storage\.from\('workspace-files'\)\.remove/);
  });
});

describe('SQEM-492 — storage policy', () => {
  it('qualifies the object name (unqualified `name` resolved to workspace_files.name)', () => {
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY "workspace_files_storage_select"'));
    const body = policy.slice(0, policy.indexOf(');\n') + 2);
    expect(body).not.toMatch(/foldername\(name\)/);
    expect((body.match(/foldername\(objects\.name\)/g) ?? []).length).toBe(4);
  });
});

describe('SQEM-492 — marketplace', () => {
  it('a Cloud submission\'s bundle stays in the submitting workspace\'s folder', () => {
    expect(SQL).toMatch(/bundle_path IS NULL OR bundle_path LIKE workspace_id::text \|\| '\/%'/);
    const fn = code(read('supabase/functions/get-marketplace-bundle/index.ts'));
    expect(fn).toMatch(/row\.workspace_id \? `\$\{row\.workspace_id\}\/` : 'submissions\/'/);
  });

  it('counters and ranking are never client-insertable', () => {
    const granted = grantList('library_templates', 'INSERT');
    for (const col of ['score', 'vote_count', 'usage_count', 'publisher_id', 'source', 'id']) {
      expect(granted).not.toContain(col);
    }
  });

  it('grants every column the remaining client insert path (the Sqemes-admin editor) sends', () => {
    // SQEM-493 — workspace submissions no longer insert from the client (marketplace-submit-cloud).
    const granted = grantList('library_templates', 'INSERT');
    const lib = code(read('lib/api/library.ts'));
    const toRow = lib.slice(lib.indexOf('function libraryTemplateToRow'), lib.indexOf('return row;', lib.indexOf('function libraryTemplateToRow')));
    const fromToRow = [...toRow.matchAll(/row\.([a-z_]+) =/g)].map(m => m[1]);
    expect(fromToRow.length).toBeGreaterThan(5);
    for (const col of fromToRow) expect(granted).toContain(col);
  });

  it('a report is filed as yourself and opens as open', () => {
    expect(SQL).toMatch(/WITH CHECK \(reporter_id = auth\.uid\(\) AND status = 'open'\)/);
  });
});

describe('SQEM-492 — access rows stay in their workspace', () => {
  it('template_access, persona_access and persona routes check the target\'s workspace', () => {
    expect(SQL).toMatch(/p\.id = template_id AND p\.workspace_id = template_access\.workspace_id/);
    expect(SQL).toMatch(/p\.id = persona_id AND p\.workspace_id = persona_access\.workspace_id/);
    expect(SQL).toMatch(/t\.id = persona_templates\.template_id AND t\.workspace_id = p\.workspace_id/);
  });
});

describe('SQEM-492 — invitations', () => {
  it('only admins invite, as themselves', () => {
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY invitations_insert'));
    expect(policy.slice(0, policy.indexOf(';'))).toMatch(/get_user_role\(workspace_id\) = 'admin'::public\.workspace_role\s+AND invited_by = auth\.uid\(\)/);
  });
});

describe('SQEM-492 — chat_sessions', () => {
  const granted = grantList('chat_sessions', 'UPDATE');

  it('never grants ownership or placement', () => {
    for (const col of ['user_id', 'workspace_id', 'created_at', 'expires_at', 'id']) {
      expect(granted).not.toContain(col);
    }
  });

  it('grants every column the app\'s updates send', () => {
    const cs = code(read('lib/api/chatSessions.ts'));
    const written = [
      ...[...fnBody(cs, 'updateChatSession').matchAll(/row\.([a-z_]+) =/g)].map(m => m[1]),
      ...[...fnBody(cs, 'updateAppliedContext').matchAll(/patch\.([a-z_]+) =/g)].map(m => m[1]),
      ...[...cs.matchAll(/\.update\(\{ ([a-z_]+):/g)].map(m => m[1]),
    ];
    expect(written).toContain('last_active_at');
    expect(written.length).toBeGreaterThan(5);
    for (const col of written) expect(granted).toContain(col);
    expect(granted).toContain('pinned'); // the extension PATCHes pinned (sqemes-extension src/lib/api.ts)
  });
});

describe('SQEM-492 — ownership columns', () => {
  it('a guard trigger keeps created_by / workspace_id / usage_count for client roles only', () => {
    const fn = SQL.slice(SQL.indexOf('FUNCTION public.guard_client_owned_columns'));
    expect(fn).toMatch(/IF current_user NOT IN \('authenticated', 'anon'\) THEN\s+RETURN NEW;/);
    expect(fn).toMatch(/NEW\.created_by := auth\.uid\(\);/);
    expect(fn).toMatch(/NEW\.created_by := OLD\.created_by;/);
    expect(fn).toMatch(/NEW\.workspace_id := OLD\.workspace_id;/);
    for (const t of ['prompts', 'personas', 'workspace_files']) {
      expect(SQL).toMatch(new RegExp(`CREATE TRIGGER guard_client_owned_columns BEFORE INSERT OR UPDATE ON public\\.${t}`));
    }
  });

  it('fails the migration if a protected column is still writable', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'SQEM-492/);
  });
});
