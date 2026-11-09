import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-666 — moderation of new playbooks and personas. With `moderation_new` on, what a non-moderator
 * creates starts in review state `draft` (only the owner sees it), `pending` after submitting (owner,
 * moderators, admins), `rejected` (owner only), released = the access rows apply as before.
 *
 * Workspace A: a1 admin, a2 member (seed); E1 editor (writes), M editor + moderator, E3 editor (not a
 * moderator). Each test sets up what it needs and the state is reset in beforeAll only — the tests
 * run in order.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000006a1';
const M = 'aaaaaaaa-0000-4000-8000-0000000006a2';
const E3 = 'aaaaaaaa-0000-4000-8000-0000000006a3';
const T = 'aaaaaaaa-0000-4000-8000-00000000b6a1';
const T2 = 'aaaaaaaa-0000-4000-8000-00000000b6a2';
const P = 'aaaaaaaa-0000-4000-8000-00000000b6b1';
const TM = 'aaaaaaaa-0000-4000-8000-00000000b6c1';

/** Run statements as `uid` and keep them (commit). */
function as(uid: string, stmts: string): string[][] {
  return sql(`begin;
    do $$ begin
      perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);
      perform set_config('request.jwt.claim.sub', ${lit(uid)}, true);
    end $$;
    set local role authenticated;
    ${stmts}
    commit;`);
}
const probe = (uid: string, stmt: string, count = false) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, ${count})`);
const sees = (uid: string, id: string) => probe(uid, `select id from public.prompts where id = '${id}'`);
const stateOf = (id: string, table = 'prompts') => one(`select coalesce(review_state, 'released') from public.${table} where id = '${id}'`);

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${E1}', 'm666a@isolation.invalid'), ('${M}', 'm666b@isolation.invalid'), ('${E3}', 'm666c@isolation.invalid')) as u(id, email)
    on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor'), ('${A}', '${M}', 'editor'), ('${A}', '${E3}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    delete from public.prompts where id in ('${T}', '${T2}', '${TM}');
    delete from public.personas where id = '${P}';
    delete from public.workspace_moderators where workspace_id = '${A}';
    update public.workspaces set moderation_new = false where id = '${A}';
  `);
});

describe('SQEM-666 — the switch and the moderators', () => {
  it('off: a new playbook is released at once, as today', () => {
    as(E1, `insert into public.prompts (id, workspace_id, title, content, kind) values ('${T}', '${A}', 'off', 'x', 'skill');`);
    expect(stateOf(T)).toBe('released');
    sql(`delete from public.prompts where id = '${T}';`);
  });

  it('only an admin can switch it on; an editor\'s write keeps the old value', () => {
    as(E1, `update public.workspaces set moderation_new = true where id = '${A}';`);
    expect(one(`select moderation_new from public.workspaces where id = '${A}'`)).toBe('f');
    as(USERS.a1, `update public.workspaces set moderation_new = true where id = '${A}';`);
    expect(one(`select moderation_new from public.workspaces where id = '${A}'`)).toBe('t');
  });

  it('moderators: an admin adds an editor; a member cannot be one; an editor cannot add', () => {
    as(USERS.a1, `insert into public.workspace_moderators (workspace_id, user_id) values ('${A}', '${M}');`);
    expect(probe(USERS.a1, `insert into public.workspace_moderators (workspace_id, user_id) values ('${A}', '${USERS.a2}')`)).toMatch(/^err=42501/);
    expect(probe(E1, `insert into public.workspace_moderators (workspace_id, user_id) values ('${A}', '${E1}')`)).toMatch(/^err=42501/);
  });
});

describe('SQEM-666 — a new playbook of an editor', () => {
  it('starts as draft, whatever the client sends; only the owner sees it — not the moderator, not the admin', () => {
    as(E1, `insert into public.prompts (id, workspace_id, title, content, kind, review_state) values ('${T}', '${A}', 'new', 'x', 'skill', null);`);
    expect(stateOf(T)).toBe('draft');
    expect(sees(E1, T)).toBe('rows=1');
    expect(sees(M, T)).toBe('rows=0');
    expect(sees(USERS.a1, T)).toBe('rows=0');
    expect(sees(USERS.a2, T)).toBe('rows=0');
  });

  it('⛔ a direct write of the state is ignored — only the RPCs change it', () => {
    as(E1, `update public.prompts set review_state = null where id = '${T}';`);
    expect(stateOf(T)).toBe('draft');
  });

  it('only the owner submits; then the moderator and the admin see it, a member and another editor do not', () => {
    expect(probe(E3, `select public.submit_for_review('template', '${T}')`)).toMatch(/^err=42501/);
    as(E1, `select public.submit_for_review('template', '${T}');`);
    expect(stateOf(T)).toBe('pending');
    expect(sees(M, T)).toBe('rows=1');
    expect(sees(USERS.a1, T)).toBe('rows=1');
    expect(sees(USERS.a2, T)).toBe('rows=0');
    expect(sees(E3, T)).toBe('rows=0');
  });

  it('the MCP set follows the same gate', () => {
    const mcp = (uid: string) => one(`select count(*) from public.mcp_accessible_template_ids('${A}', '${uid}') x where x.id = '${T}'`);
    expect(mcp(M)).toBe('1');
    expect(mcp(USERS.a2)).toBe('0');
    expect(mcp(E3)).toBe('0');
  });

  it('⛔ an editor who is not a moderator cannot decide; another tenant cannot either', () => {
    expect(probe(E3, `select public.decide_review('template', '${T}', true)`)).toMatch(/^err=42501/);
    expect(probe(USERS.b1, `select public.decide_review('template', '${T}', true)`)).toMatch(/^err=42501/);
  });

  it('a moderator releases it: the access rows apply — open, so the member sees it now', () => {
    as(M, `select public.decide_review('template', '${T}', true);`);
    expect(stateOf(T)).toBe('released');
    expect(sees(USERS.a2, T)).toBe('rows=1');
    expect(one(`select review_decided_by from public.prompts where id = '${T}'`)).toBe(M);
  });

  it('rejected: back to the owner alone, with the reason', () => {
    as(E1, `insert into public.prompts (id, workspace_id, title, content, kind) values ('${T2}', '${A}', 'second', 'x', 'skill');
      select public.submit_for_review('template', '${T2}');`);
    as(USERS.a1, `select public.decide_review('template', '${T2}', false, 'Bitte Quellen ergänzen');`);
    expect(stateOf(T2)).toBe('rejected');
    expect(one(`select review_note from public.prompts where id = '${T2}'`)).toBe('Bitte Quellen ergänzen');
    expect(sees(M, T2)).toBe('rows=0');
    expect(sees(E1, T2)).toBe('rows=1');
  });

  it('a moderator\'s own new playbook needs no review', () => {
    as(M, `insert into public.prompts (id, workspace_id, title, content, kind) values ('${TM}', '${A}', 'by moderator', 'x', 'skill');`);
    expect(stateOf(TM)).toBe('released');
  });
});

describe('SQEM-666 — personas', () => {
  it('draft → pending → released, through the same gate', () => {
    as(E1, `insert into public.personas (id, workspace_id, title) values ('${P}', '${A}', 'Rolle');`);
    expect(stateOf(P, 'personas')).toBe('draft');
    const seesP = (uid: string) => probe(uid, `select id from public.personas where id = '${P}'`);
    expect(seesP(M)).toBe('rows=0');
    as(E1, `select public.submit_for_review('persona', '${P}');`);
    expect(seesP(M)).toBe('rows=1');
    expect(seesP(USERS.a2)).toBe('rows=0');
    as(M, `select public.decide_review('persona', '${P}', true);`);
    expect(seesP(USERS.a2)).toBe('rows=1');
  });
});

describe('SQEM-666 — a demoted moderator is out', () => {
  it('demoting to member removes the moderator row, and with it the right to decide', () => {
    sql(`update public.workspace_members set role = 'member' where workspace_id = '${A}' and user_id = '${M}';`);
    expect(one(`select count(*) from public.workspace_moderators where workspace_id = '${A}' and user_id = '${M}'`)).toBe('0');
    sql(`update public.workspace_members set role = 'editor' where workspace_id = '${A}' and user_id = '${M}';`);
    expect(one(`select count(*) from public.workspace_moderators where workspace_id = '${A}' and user_id = '${M}'`)).toBe('0');
  });
});
