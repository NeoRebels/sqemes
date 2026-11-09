import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-667 — changes to shared playbooks and personas wait for review. With both switches on in
 * workspace A: E1 (editor, owner of the objects) may not write a shared one directly, nor change access of
 * a released one, nor delete a file a shared playbook uses; E1 submits a change; M (editor + moderator)
 * or the admin releases it, which writes it as a version credited to E1.
 *
 * The state is set up once by the superuser (no uid: the locks let it through) and the tests run in order.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000007a1';
const M = 'aaaaaaaa-0000-4000-8000-0000000007a2';
const E3 = 'aaaaaaaa-0000-4000-8000-0000000007a3';
const T = 'aaaaaaaa-0000-4000-8000-00000000c7a1';       // shared (open), owned by E1
const T_ONLY = 'aaaaaaaa-0000-4000-8000-00000000c7a2';  // released, "only me"
const P = 'aaaaaaaa-0000-4000-8000-00000000c7b1';       // shared persona, owned by E1
const F = 'aaaaaaaa-0000-4000-8000-00000000c7f1';       // file T uses

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
const probe = (uid: string, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, false)`);
const changeId = () => one(`select id from public.pending_changes where object_id = '${T}' and author = '${E1}'`);

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${E1}', 'c667a@isolation.invalid'), ('${M}', 'c667b@isolation.invalid'), ('${E3}', 'c667c@isolation.invalid')) as u(id, email)
    on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor'), ('${A}', '${M}', 'editor'), ('${A}', '${E3}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    insert into public.workspace_moderators (workspace_id, user_id) values ('${A}', '${M}') on conflict do nothing;
    update public.workspaces set moderation_new = true, moderation_changes = true where id = '${A}';
    insert into public.workspace_files (id, workspace_id, name, storage_path, mime_type, size_bytes, created_by)
      values ('${F}', '${A}', 'c667.md', '${A}/c667.md', 'text/markdown', 10, '${E1}') on conflict do nothing;
    insert into public.prompts (id, workspace_id, title, content, kind, created_by, context_file_ids)
      values ('${T}', '${A}', 'shared', 'x', 'skill', '${E1}', array['${F}']::uuid[]),
             ('${T_ONLY}', '${A}', 'only me', 'x', 'skill', '${E1}', '{}') on conflict do nothing;
    update public.prompts set review_state = null where id in ('${T}', '${T_ONLY}');
    insert into public.template_access (template_id, workspace_id) values ('${T_ONLY}', '${A}');
    insert into public.personas (id, workspace_id, title, created_by) values ('${P}', '${A}', 'shared persona', '${E1}') on conflict do nothing;
    update public.personas set review_state = null where id = '${P}';
  `);
});

describe('SQEM-667 — the switch', () => {
  it('reviewing changes works only together with reviewing new ones', () => {
    expect(one(`select moderation_changes from public.workspaces where id = '${A}'`)).toBe('t');
    sql(`update public.workspaces set moderation_new = false where id = '${A}';`);
    expect(one(`select moderation_changes from public.workspaces where id = '${A}'`)).toBe('f');
    sql(`update public.workspaces set moderation_new = true, moderation_changes = true where id = '${A}';`);
    expect(one(`select moderation_changes from public.workspaces where id = '${A}'`)).toBe('t');
  });
});

describe('SQEM-667 — the locks', () => {
  it('⛔ an editor cannot write a shared playbook or persona directly; their own "only me" one they can', () => {
    expect(probe(E1, `update public.prompts set title = 'direct' where id = '${T}'`)).toMatch(/^err=42501/);
    expect(probe(E1, `update public.personas set title = 'direct' where id = '${P}'`)).toMatch(/^err=42501/);
    expect(probe(E1, `update public.prompts set title = 'mine alone' where id = '${T_ONLY}'`)).toBe('rows=1');
  });
  it('⛔ access of anything released is a change: widening "only me" is refused for the editor', () => {
    expect(probe(E1, `delete from public.template_access where template_id = '${T_ONLY}'`)).toMatch(/^err=42501/);
  });
  it('⛔ the routes of a shared persona, and a file a shared playbook uses, are locked too', () => {
    expect(probe(E1, `insert into public.persona_templates (persona_id, template_id, condition) values ('${P}', '${T_ONLY}', 'x')`)).toMatch(/^err=42501/);
    expect(probe(E1, `delete from public.workspace_files where id = '${F}'`)).toMatch(/^err=42501/);
  });
  it('moderators and admins write directly', () => {
    expect(probe(M, `update public.prompts set description = 'by moderator' where id = '${T}'`)).toBe('rows=1');
    expect(probe(USERS.a1, `update public.prompts set description = 'by admin' where id = '${T}'`)).toBe('rows=1');
  });
});

describe('SQEM-667 — submitting and deciding', () => {
  it('the editor submits; the moderator sees it, a member and another editor do not', () => {
    as(E1, `select public.submit_change('template', '${T}', '{"title": "proposed", "content": "y"}'::jsonb,
      (select updated_at from public.prompts where id = '${T}'));`);
    expect(changeId()).toMatch(/^[0-9a-f-]{36}$/);
    const seesChange = (uid: string) => probe(uid, `select id from public.pending_changes where object_id = '${T}'`);
    expect(seesChange(M)).toBe('rows=1');
    expect(seesChange(E1)).toBe('rows=1');
    expect(seesChange(USERS.a2)).toBe('rows=0');
    expect(seesChange(E3)).toBe('rows=0');
  });
  it('⛔ an editor who is not a moderator cannot decide, nor another tenant', () => {
    expect(probe(E3, `select public.decide_change('${changeId()}', true)`)).toMatch(/^err=42501/);
    expect(probe(USERS.b1, `select public.decide_change('${changeId()}', true)`)).toMatch(/^err=42501/);
  });
  it('released: written as a version by the author, noted, and the proposal is gone', () => {
    as(M, `select public.decide_change('${changeId()}', true);`);
    expect(one(`select title || '|' || content from public.prompts where id = '${T}'`)).toBe('proposed|y');
    expect(one(`select created_by || '|' || coalesce(note, '') from public.template_versions where template_id = '${T}' order by version desc limit 1`)).toBe(`${E1}|Released after review`);
    expect(one(`select count(*) from public.pending_changes where object_id = '${T}'`)).toBe('0');
  });
  it('changed since it was submitted: refused without force, released with it', () => {
    as(E1, `select public.submit_change('template', '${T}', '{"title": "late"}'::jsonb, now() - interval '1 hour');`);
    expect(probe(M, `select public.decide_change('${changeId()}', true)`)).toMatch(/^err=40001/);
    as(M, `select public.decide_change('${changeId()}', true, null, true);`);
    expect(one(`select title from public.prompts where id = '${T}'`)).toBe('late');
  });
  it('rejected: stays with its author, with the reason', () => {
    as(E1, `select public.submit_change('template', '${T}', '{"title": "no"}'::jsonb, (select updated_at from public.prompts where id = '${T}'));`);
    as(USERS.a1, `select public.decide_change('${changeId()}', false, 'Bitte nicht');`);
    expect(one(`select state || '|' || note from public.pending_changes where object_id = '${T}'`)).toBe('rejected|Bitte nicht');
    expect(one(`select title from public.prompts where id = '${T}'`)).toBe('late');
  });
  it('a persona change releases routes and fields', () => {
    as(E1, `select public.submit_change('persona', '${P}', '{"title": "renamed", "routes": [{"template_id": "${T}", "condition": "always"}]}'::jsonb, null);`);
    const id = one(`select id from public.pending_changes where object_id = '${P}'`);
    as(M, `select public.decide_change('${id}', true);`);
    expect(one(`select title from public.personas where id = '${P}'`)).toBe('renamed');
    expect(one(`select count(*) from public.persona_templates where persona_id = '${P}' and template_id = '${T}'`)).toBe('1');
  });
});
