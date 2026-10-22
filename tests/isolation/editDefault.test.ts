import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-534 — the workspace default for "Who can edit". With it set, every new playbook and persona
 * starts restricted to its creator (plus admins) — whichever way it was created. Only an admin may
 * change the setting.
 *
 * E1 and E2 are editors of workspace A beside the seed's admin a1. `inTx` runs statements as one user
 * and rolls them back, returning the rows of the last SELECT; `probe` runs one statement and rolls back.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const E2 = 'aaaaaaaa-0000-4000-8000-0000000000e2';
const NEW_T = 'aaaaaaaa-0000-4000-8000-00000000a5e1';
const NEW_P = 'aaaaaaaa-0000-4000-8000-00000000a5e2';

const probe = (uid: string, stmt: string, count = false) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, ${count})`);

function inTx(uid: string | null, role: string, stmts: string, finalSelect: string): string {
  const claims = uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role });
  const rows = sql(`begin;
    do $$ begin
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.jwt.claim.sub', ${lit(uid ?? '')}, true);
      perform set_config('request.jwt.claim.role', ${lit(role)}, true);
    end $$;
    set local role ${role};
    ${stmts}
    ${finalSelect};
    rollback;`);
  return rows.at(-1)?.[0] ?? '';
}

const setDefault = (on: boolean) => sql(`update public.workspaces set default_edit_restricted = ${on} where id = '${A}';`);
const insertTemplate = `insert into public.prompts (id, workspace_id, title, content, kind) values ('${NEW_T}', '${A}', 'new', 'x', 'skill');`;
const editorsOfNew = `select coalesce(string_agg(user_id::text, ','), '') from public.template_editors where template_id = '${NEW_T}'`;

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${E1}', 'e1@isolation.invalid'), ('${E2}', 'e2@isolation.invalid')) as u(id, email);
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor'), ('${A}', '${E2}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
  `);
});

describe('SQEM-534 — the default off (as today)', () => {
  it('a new playbook has no editor list', () => {
    setDefault(false);
    expect(inTx(E1, 'authenticated', insertTemplate, editorsOfNew)).toBe('');
  });
});

describe('SQEM-534 — the default on', () => {
  it('a playbook an editor creates in the app is restricted to them', () => {
    setDefault(true);
    expect(inTx(E1, 'authenticated', insertTemplate, editorsOfNew)).toBe(E1);
  });
  it('…so another editor may not change it, while the creator and an admin may', () => {
    setDefault(true);
    const upd = `update public.prompts set title = 'changed' where id = '${NEW_T}'`;
    const changedBy = (who: string) => sql(`begin;
      do $$ begin
        perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: E1, role: 'authenticated' }))}, true);
        perform set_config('request.jwt.claim.sub', ${lit(E1)}, true);
      end $$;
      set local role authenticated;
      ${insertTemplate}
      do $$ begin
        perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: who, role: 'authenticated' }))}, true);
        perform set_config('request.jwt.claim.sub', ${lit(who)}, true);
      end $$;
      with u as (${upd} returning 1) select count(*) from u;
      rollback;`).at(-1)?.[0];
    expect(changedBy(E2)).toBe('0');
    expect(changedBy(E1)).toBe('1');
    expect(changedBy(USERS.a1)).toBe('1');
  });
  it('⛔ a playbook created through the MCP server (service role) is restricted too', () => {
    setDefault(true);
    const svcInsert = `insert into public.prompts (id, workspace_id, title, content, kind, created_by) values ('${NEW_T}', '${A}', 'via mcp', 'x', 'skill', '${E1}');`;
    expect(inTx(null, 'service_role', svcInsert, editorsOfNew)).toBe(E1);
  });
  it('a persona is restricted the same way', () => {
    setDefault(true);
    expect(inTx(E1, 'authenticated',
      `insert into public.personas (id, workspace_id, title, content) values ('${NEW_P}', '${A}', 'p', 'x');`,
      `select coalesce(string_agg(user_id::text, ','), '') from public.persona_editors where persona_id = '${NEW_P}'`)).toBe(E1);
  });
  it('without an owner nothing is written — "only nobody" cannot be expressed', () => {
    setDefault(true);
    const noOwner = `insert into public.prompts (id, workspace_id, title, content, kind) values ('${NEW_T}', '${A}', 'orphan', 'x', 'skill');`;
    expect(inTx(null, 'service_role', noOwner, editorsOfNew)).toBe('');
  });
  it('⛔ an editor creating one the way the app does (insert().select()) still gets it back', () => {
    setDefault(true);
    expect(probe(E1, `with i as (insert into public.prompts (workspace_id, title, content, kind) values ('${A}', 'n', 'x', 'prompt') returning id) select count(*) from i`, true)).toBe('rows=1');
  });
  it('existing playbooks are not touched by switching it on', () => {
    setDefault(false);
    setDefault(true);
    expect(one(`select count(*) from public.template_editors where template_id = 'aaaaaaaa-0000-4000-8000-00000000a001'`)).toBe('0');
  });
});

describe('SQEM-534 — who may change the setting', () => {
  it('⛔ an editor cannot: the write succeeds and the value stays', () => {
    setDefault(true);
    expect(inTx(E1, 'authenticated', `update public.workspaces set default_edit_restricted = false where id = '${A}';`,
      `select default_edit_restricted::text from public.workspaces where id = '${A}'`)).toBe('true');
  });
  it('an admin can', () => {
    setDefault(true);
    expect(inTx(USERS.a1, 'authenticated', `update public.workspaces set default_edit_restricted = false where id = '${A}';`,
      `select default_edit_restricted::text from public.workspaces where id = '${A}'`)).toBe('false');
    setDefault(false);
  });
  it('⛔ the trigger function is not callable by clients', () => {
    expect(one(`select has_function_privilege('authenticated', 'public.apply_default_edit_restriction()', 'execute')::text`)).toBe('false');
  });
});
