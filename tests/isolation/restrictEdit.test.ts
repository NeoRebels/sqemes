import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-473 — who may CHANGE a playbook or persona, separately from who may see it.
 *
 * Two editors are added to workspace A beside the seed's admin (a1) and member (a2):
 *   E1 — an editor who is NOT on the editor list (must be refused on every write path)
 *   E2 — an editor who IS on it (must succeed)
 * The open template a001 (owned by a1) and the persona a101 are restricted to E2 for the tests.
 * Probes run one statement as a role and roll it back (isolation_test.probe).
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const E2 = 'aaaaaaaa-0000-4000-8000-0000000000e2';
const T_OPEN = 'aaaaaaaa-0000-4000-8000-00000000a001';
const PERSONA = 'aaaaaaaa-0000-4000-8000-00000000a101';
const FILE_OF_T = 'aaaaaaaa-0000-4000-8000-00000000a301'; // listed by a001
const ORPHAN = 'aaaaaaaa-0000-4000-8000-00000000a302';    // listed by nothing
const GROUP = 'aaaaaaaa-0000-4000-8000-00000000a201';

const probe = (uid: string, stmt: string, count = false) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, ${count})`);
const updateTemplate = `update public.prompts set title = 'changed' where id = '${T_OPEN}'`;
const deleteTemplate = `delete from public.prompts where id = '${T_OPEN}'`;
const updatePersona = `update public.personas set title = 'changed' where id = '${PERSONA}'`;

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
    -- the seed restricts a101 to the group; replace that with E2 so the cases below are about one person
    delete from public.persona_editors where persona_id = '${PERSONA}';
    insert into public.template_editors (template_id, workspace_id, user_id, created_by) values ('${T_OPEN}', '${A}', '${E2}', '${USERS.a1}');
    insert into public.persona_editors (persona_id, workspace_id, user_id, created_by) values ('${PERSONA}', '${A}', '${E2}', '${USERS.a1}');
    -- a101 is visible to a2 only in the seed; E1 and E2 must SEE it, or the cases test sight, not editing
    insert into public.persona_access (persona_id, workspace_id, user_id, created_by)
      values ('${PERSONA}', '${A}', '${E1}', '${USERS.a1}'), ('${PERSONA}', '${A}', '${E2}', '${USERS.a1}');
  `);
});

describe('SQEM-473 — a restricted playbook', () => {
  it('⛔ an editor NOT on the list cannot change or delete it (RLS filters the row: 0 rows)', () => {
    expect(probe(E1, updateTemplate)).toBe('rows=0');
    expect(probe(E1, deleteTemplate)).toBe('rows=0');
  });
  it('…but can still SEE and use it — the restriction is about editing only', () => {
    expect(probe(E1, `select count(*) from public.prompts where id = '${T_OPEN}'`, true)).toBe('rows=1');
  });
  it('an editor ON the list can change it', () => {
    expect(probe(E2, updateTemplate)).toBe('rows=1');
  });
  it('an admin can always change it (overrides the restriction)', () => {
    expect(probe(USERS.a1, updateTemplate)).toBe('rows=1');
  });
  it('a member still cannot', () => {
    expect(probe(USERS.a2, updateTemplate)).toBe('rows=0');
  });
  it('⛔ the editor NOT on the list cannot change who may SEE it (the gap SQEM-473 closes)', () => {
    expect(probe(E1, `insert into public.template_access (template_id, workspace_id, user_id) values ('${T_OPEN}', '${A}', '${E1}')`)).toMatch(/^err=42501/);
  });
  it('⛔ nor lift the restriction — only the owner or an admin manages the editor list', () => {
    expect(probe(E1, `delete from public.template_editors where template_id = '${T_OPEN}'`)).toBe('rows=0');
    expect(probe(E2, `insert into public.template_editors (template_id, workspace_id, user_id) values ('${T_OPEN}', '${A}', '${E1}')`)).toMatch(/^err=42501/);
    expect(probe(USERS.a1, `insert into public.template_editors (template_id, workspace_id, user_id) values ('${T_OPEN}', '${A}', '${E1}')`)).toBe('rows=1');
  });
  it('a group on the list counts for its members', () => {
    sql(`insert into public.workspace_group_members (group_id, user_id) values ('${GROUP}', '${E1}') on conflict do nothing;
         insert into public.template_editors (template_id, workspace_id, group_id, created_by) values ('${T_OPEN}', '${A}', '${GROUP}', '${USERS.a1}');`);
    try {
      expect(probe(E1, updateTemplate)).toBe('rows=1');
    } finally {
      sql(`delete from public.template_editors where template_id = '${T_OPEN}' and group_id = '${GROUP}';
           delete from public.workspace_group_members where group_id = '${GROUP}' and user_id = '${E1}';`);
    }
    expect(probe(E1, updateTemplate)).toBe('rows=0');
  });
});

describe('SQEM-473 — an owner-editor restricts their own playbook', () => {
  const OWN = 'aaaaaaaa-0000-4000-8000-00000000a0e1';
  beforeAll(() => sql(`insert into public.prompts (id, workspace_id, title, content, kind, created_by, published)
                       values ('${OWN}', '${A}', 'E1 own', 'x', 'prompt', '${E1}', true) on conflict do nothing;`));
  it('the owner may restrict it and still edit it; another editor then may not', () => {
    expect(probe(E1, `insert into public.template_editors (template_id, workspace_id, user_id) values ('${OWN}', '${A}', '${USERS.a1}')`)).toBe('rows=1');
    sql(`insert into public.template_editors (template_id, workspace_id, user_id, created_by) values ('${OWN}', '${A}', '${USERS.a1}', '${E1}') on conflict do nothing;`);
    expect(probe(E1, `update public.prompts set title = 'mine' where id = '${OWN}'`)).toBe('rows=1');
    expect(probe(E2, `update public.prompts set title = 'not mine' where id = '${OWN}'`)).toBe('rows=0');
  });
  it('⛔ an editor creating a playbook the way the app does (insert().select()) still gets it back', () => {
    const create = `with i as (insert into public.prompts (workspace_id, title, content, kind) values ('${A}', 'new', 'x', 'prompt') returning id) select count(*) from i`;
    expect(probe(E1, create, true)).toBe('rows=1');
  });
});

describe('SQEM-473 — a restricted persona', () => {
  it('⛔ the editor NOT on the list cannot change it, its routes, or who may see it', () => {
    expect(probe(E1, updatePersona)).toBe('rows=0');
    expect(probe(E1, `insert into public.persona_templates (persona_id, template_id, condition) values ('${PERSONA}', 'aaaaaaaa-0000-4000-8000-00000000a002', 'x')`)).toMatch(/^err=42501/);
    expect(probe(E1, `delete from public.persona_templates where persona_id = '${PERSONA}'`)).toBe('rows=0');
    expect(probe(E1, `insert into public.persona_access (persona_id, workspace_id, user_id) values ('${PERSONA}', '${A}', '${E1}')`)).toMatch(/^err=42501/);
  });
  it('the restriction leaves sight alone: the member a2 still sees the persona', () => {
    expect(probe(USERS.a2, `select count(*) from public.personas where id = '${PERSONA}'`, true)).toBe('rows=1');
  });
  it('the editor ON the list and the admin can', () => {
    expect(probe(E2, updatePersona)).toBe('rows=1');
    expect(probe(USERS.a1, updatePersona)).toBe('rows=1');
  });
});

describe('SQEM-473 — files of a restricted playbook (decision 2a)', () => {
  it('⛔ the editor NOT on the list cannot rename a file the restricted playbook lists', () => {
    expect(probe(E1, `update public.workspace_files set name = 'x.md' where id = '${FILE_OF_T}'`)).toBe('rows=0');
  });
  it('the editor ON the list can; a file no restricted playbook lists keeps today\'s rule', () => {
    expect(probe(E2, `update public.workspace_files set name = 'x.md' where id = '${FILE_OF_T}'`)).toBe('rows=1');
    sql(`update public.workspace_files set created_by = '${E1}' where id = '${ORPHAN}';`); // make it visible to E1
    expect(probe(E1, `update public.workspace_files set name = 'y.md' where id = '${ORPHAN}'`)).toBe('rows=1');
  });
});

describe('SQEM-473 — one rule for the app and the MCP server', () => {
  it('the user-id form agrees with what RLS enforces', () => {
    const r = (fn: string, id: string, u: string) => one(`select public.${fn}('${id}', '${u}')`);
    expect([r('template_edit_allowed', T_OPEN, E1), r('template_edit_allowed', T_OPEN, E2), r('template_edit_allowed', T_OPEN, USERS.a1), r('template_edit_allowed', T_OPEN, USERS.a2)]).toEqual(['f', 't', 't', 'f']);
    expect([r('persona_edit_allowed', PERSONA, E1), r('persona_edit_allowed', PERSONA, E2)]).toEqual(['f', 't']);
    expect(one(`select public.file_edit_allowed('${FILE_OF_T}', '${A}', '${E1}')`)).toBe('f');
  });
  it('⛔ clients cannot ask the user-id form about somebody else', () => {
    expect(probe(E1, `select public.template_edit_allowed('${T_OPEN}', '${E2}')`)).toMatch(/^err=42501/);
    expect(probe(E1, `select public.file_edit_allowed('${FILE_OF_T}', '${A}', '${E2}')`)).toMatch(/^err=42501/);
  });
});
