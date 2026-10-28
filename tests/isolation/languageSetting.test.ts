import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-600 — the workspace language is an admin's to set; the profile language is each person's own.
 * E1 is an editor of workspace A beside the seed's admin a1 (and a2). `inTx` runs statements as one
 * user and rolls back, returning the last SELECT.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000000e1';

function inTx(uid: string, stmts: string, finalSelect: string): string {
  const rows = sql(`begin;
    do $$ begin
      perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);
      perform set_config('request.jwt.claim.sub', ${lit(uid)}, true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
    end $$;
    set local role authenticated;
    ${stmts}
    ${finalSelect};
    rollback;`);
  return rows.at(-1)?.[0] ?? '';
}

const wsLanguage = `select language from public.workspaces where id = '${A}'`;
const profileLanguage = (uid: string) => `select coalesce(language, 'null') from public.profiles where id = '${uid}'`;

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', '${E1}', 'authenticated', 'authenticated', 'e1@isolation.invalid', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '')
    on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
  `);
});

describe('SQEM-600 — the workspace language', () => {
  it('defaults to English', () => {
    expect(sql(wsLanguage)[0][0]).toBe('en');
  });
  it('an admin can change it', () => {
    expect(inTx(USERS.a1, `update public.workspaces set language = 'de' where id = '${A}';`, wsLanguage)).toBe('de');
  });
  it('⛔ an editor cannot: the write succeeds and the value stays', () => {
    expect(inTx(E1, `update public.workspaces set language = 'de' where id = '${A}';`, wsLanguage)).toBe('en');
  });
  it('⛔ only supported languages are accepted', () => {
    expect(() => sql(`update public.workspaces set language = 'fr' where id = '${A}';`)).toThrow();
  });
});

describe('SQEM-600 — the profile language', () => {
  it('starts empty (follow the workspace)', () => {
    expect(sql(profileLanguage(USERS.a1))[0][0]).toBe('null');
  });
  it('a person can set their own, and clear it again', () => {
    expect(inTx(USERS.a2, `update public.profiles set language = 'de' where id = '${USERS.a2}';`, profileLanguage(USERS.a2))).toBe('de');
    expect(inTx(USERS.a2, `update public.profiles set language = null where id = '${USERS.a2}';`, profileLanguage(USERS.a2))).toBe('null');
  });
  it("⛔ nobody can set someone else's", () => {
    expect(inTx(USERS.a2, `update public.profiles set language = 'de' where id = '${USERS.a1}';`, profileLanguage(USERS.a1))).toBe('null');
  });
});
