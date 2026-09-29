import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-491 — `profiles.email` is a mirror of the login address, and invitations stop trusting it.
 *
 * Before: Settings wrote any address to `profiles.email` (unconfirmed, login untouched), and
 * `invitations_update` identified the invitee by that same address, with no WITH CHECK.
 * After: only a trigger on auth.users writes the profile email; only a workspace admin updates an
 * invitation, only the columns "Resend" needs, and the new row must stay in their workspace.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments before block comments — see comment-stripper order in source tests.
const code = (src: string) => src
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const sqlCode = (src: string) => src.replace(/--.*$/gm, '');

const SQL = sqlCode(read('supabase/migrations/20260929190000_sqem491_email_mirror_invitations.sql'));

describe('SQEM-491 — profile email', () => {
  it('the client may no longer write profiles.email', () => {
    expect(SQL).toMatch(/REVOKE UPDATE \(email\) ON public\.profiles FROM anon, authenticated/);
  });

  it('a trigger on auth.users mirrors the confirmed login address', () => {
    expect(SQL).toMatch(/AFTER UPDATE OF email ON auth\.users/);
    expect(SQL).toMatch(/WHEN \(OLD\.email IS DISTINCT FROM NEW\.email\)/);
    expect(SQL).toMatch(/sync_profile_email_from_auth\(\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/);
  });

  it('updateUser no longer sends email', () => {
    const store = code(read('store/workspace.tsx'));
    const body = store.slice(store.indexOf('const updateUser'), store.indexOf(".from('profiles').update"));
    expect(body).not.toMatch(/dbUpdates\.email/);
  });

  it('Settings changes the LOGIN address through GoTrue, with a redirect', () => {
    const settings = code(read('pages/Settings.tsx'));
    expect(settings).toMatch(/supabase\.auth\.updateUser\(\s*\{\s*email: newEmail\s*\}/);
    expect(settings).not.toMatch(/updates\.email\s*=/);
  });

  it('the first confirmation link (#message=) does not end on a 404', () => {
    const app = code(read('App.tsx'));
    expect(app).toMatch(/hash\.startsWith\('#message='\)/);
    expect(app).toMatch(/sqm_auth_message/);
  });
});

describe('SQEM-491 — invitations', () => {
  it('only a workspace admin updates, and the new row is checked too', () => {
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY invitations_update'));
    expect(policy).toMatch(/USING \(public\.get_user_role\(workspace_id\) = 'admin'/);
    expect(policy).toMatch(/WITH CHECK \(public\.get_user_role\(workspace_id\) = 'admin'/);
    expect(policy.slice(0, policy.indexOf(';'))).not.toMatch(/profiles|email/);
  });

  const granted = (() => {
    // The only column list in this migration is the invitations grant.
    const list = SQL.match(/cols\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/);
    if (!list) throw new Error('invitation column list not found');
    return [...list[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  })();

  it('never grants the columns that decide who joins where, as what', () => {
    for (const col of ['workspace_id', 'email', 'role', 'status', 'invited_by']) {
      expect(granted).not.toContain(col);
    }
    expect(SQL).toMatch(/REVOKE UPDATE ON public\.invitations FROM anon, authenticated/);
  });

  it('grants every column the client update ("Resend") writes', () => {
    const api = code(read('lib/api/invitations.ts'));
    const body = api.slice(api.indexOf('export async function resendInvitation'));
    const update = body.slice(body.indexOf('.update({'), body.indexOf('})', body.indexOf('.update({')));
    const written = [...update.matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1]);
    expect(written.length).toBeGreaterThan(0);
    for (const col of written) expect(granted).toContain(col);
  });

  it('there is no other client update on invitations', () => {
    const walk = (dir: string): string[] => readdirSync(resolve(ROOT, dir), { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
    const files = ['store', 'lib', 'components', 'pages', 'hooks'].flatMap(walk).concat('App.tsx');
    const writers = files.filter(f => /from\(\s*'invitations'\s*\)\s*\.(update|upsert)\(/.test(code(read(f))));
    expect(writers).toEqual(['lib/api/invitations.ts']);
  });

  it('fails the migration if a protected column is still writable', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'SQEM-491/);
  });
});
