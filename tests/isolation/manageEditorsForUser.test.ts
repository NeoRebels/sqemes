import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-663 — who may SET the editor list, asked for a given person (`set_editors` over MCP and Chat,
 * which write with the service key). The rule must be the client form's exactly: an admin, or the
 * owner while an editor, for something they can see.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000006e1'; // editor, owns OWN
const E2 = 'aaaaaaaa-0000-4000-8000-0000000006e2'; // editor, owns nothing
const OWN = 'aaaaaaaa-0000-4000-8000-00000000a6e1';
const PERSONA_OWN = 'aaaaaaaa-0000-4000-8000-00000000a6f1';

const allowed = (fn: string, objectId: string, user: string) =>
  one(`select public.${fn}(${lit(objectId)}::uuid, ${lit(user)}::uuid)`);
const probe = (uid: string, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, false)`);

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${E1}', 'e663a@isolation.invalid'), ('${E2}', 'e663b@isolation.invalid')) as u(id, email)
    on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor'), ('${A}', '${E2}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    insert into public.prompts (id, workspace_id, title, content, kind, created_by, published)
      values ('${OWN}', '${A}', 'E1 own (663)', 'x', 'prompt', '${E1}', true) on conflict do nothing;
    insert into public.personas (id, workspace_id, title, created_by)
      values ('${PERSONA_OWN}', '${A}', 'E1 persona (663)', '${E1}') on conflict do nothing;
  `);
});

describe('SQEM-663 — template_editors_manage_allowed / persona_editors_manage_allowed', () => {
  it('the owner while an editor may; another editor and a member may not; the admin may', () => {
    expect(allowed('template_editors_manage_allowed', OWN, E1)).toBe('t');
    expect(allowed('template_editors_manage_allowed', OWN, E2)).toBe('f');
    expect(allowed('template_editors_manage_allowed', OWN, USERS.a2)).toBe('f');
    expect(allowed('template_editors_manage_allowed', OWN, USERS.a1)).toBe('t');
    expect(allowed('persona_editors_manage_allowed', PERSONA_OWN, E1)).toBe('t');
    expect(allowed('persona_editors_manage_allowed', PERSONA_OWN, E2)).toBe('f');
    expect(allowed('persona_editors_manage_allowed', PERSONA_OWN, USERS.a1)).toBe('t');
  });

  it('⛔ another tenant\'s admin may not, for an object of workspace A', () => {
    expect(allowed('template_editors_manage_allowed', OWN, USERS.b1)).toBe('f');
    expect(allowed('persona_editors_manage_allowed', PERSONA_OWN, USERS.b1)).toBe('f');
  });

  it('⛔ a client may not call the user-id form (it would answer for anybody)', () => {
    expect(probe(E1, `select public.template_editors_manage_allowed('${OWN}', '${E2}')`)).toMatch(/^err=42501/);
    expect(probe(E1, `select public.persona_editors_manage_allowed('${PERSONA_OWN}', '${E2}')`)).toMatch(/^err=42501/);
  });

  it('the client forms still answer by the same rule for auth.uid()', () => {
    expect(probe(E1, `insert into public.template_editors (template_id, workspace_id, user_id) values ('${OWN}', '${A}', '${USERS.a1}')`)).toBe('rows=1');
    expect(probe(E2, `insert into public.template_editors (template_id, workspace_id, user_id) values ('${OWN}', '${A}', '${USERS.a1}')`)).toMatch(/^err=42501/);
  });
});
