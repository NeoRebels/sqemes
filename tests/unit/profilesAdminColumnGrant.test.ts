import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-489 — `profiles.is_sqemes_admin` was writable by every authenticated user (RLS limits the
 * row, not the column), so anyone could make themselves a Sqemes admin. The migration revokes
 * blanket UPDATE and re-grants only the columns the client writes.
 *
 * Two things must stay true, and both drift silently:
 *  1. the admin flag is never granted, and
 *  2. every column the client's single write path sends is granted — otherwise saving a profile
 *     fails with `permission denied for table profiles` (SQEM-151 was exactly that for workspaces).
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments before block comments — see comment-stripper order in source tests.
const code = (src: string) => src
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const sqlCode = (src: string) => src.replace(/--.*$/gm, '');

const SQL = sqlCode(read('supabase/migrations/20260929170000_sqem489_profiles_admin_column_grant.sql'));
const grantedColumns = (() => {
  const list = SQL.match(/cols\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/);
  if (!list) throw new Error('column list not found in the migration');
  return [...list[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
})();

describe('SQEM-489 — the migration', () => {
  it('revokes blanket UPDATE on profiles from the PostgREST roles', () => {
    expect(SQL).toMatch(/REVOKE UPDATE ON public\.profiles FROM anon, authenticated/);
  });

  it('never grants the admin flag', () => {
    expect(grantedColumns).not.toContain('is_sqemes_admin');
    expect(SQL).not.toMatch(/GRANT\s+UPDATE\s+ON\s+public\.profiles/i); // no table-wide re-grant
  });

  it('fails the migration if the flag is still writable afterwards', () => {
    expect(SQL).toMatch(/has_column_privilege\('authenticated', 'public\.profiles', 'is_sqemes_admin', 'UPDATE'\)/);
    expect(SQL).toMatch(/RAISE EXCEPTION/);
  });
});

describe('SQEM-489 — the grant covers the client write path', () => {
  const store = code(read('store/workspace.tsx'));

  it('updateUser sends only granted columns', () => {
    const body = store.slice(store.indexOf('const updateUser'), store.indexOf(".from('profiles').update"));
    const written = [...body.matchAll(/dbUpdates\.([a-z_]+)\s*=/g)].map(m => m[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const col of written) expect(grantedColumns).toContain(col);
  });

  it('there is no other client update on profiles', () => {
    const walk = (dir: string): string[] => readdirSync(resolve(ROOT, dir), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
    const files = ['store', 'lib', 'components', 'pages', 'hooks'].flatMap(walk).concat('App.tsx');
    const writers = files.filter(f => /from\(\s*'profiles'\s*\)\s*\.(update|upsert|insert)\(/.test(code(read(f))));
    expect(writers).toEqual(['store/workspace.tsx']);
  });
});
