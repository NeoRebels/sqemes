import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-669 — the review list and the released state for comparing. A moderator (M) must be able to review a
 * change to a playbook they cannot see (restricted to the member a2), and nobody else may read either.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const E1 = 'aaaaaaaa-0000-4000-8000-0000000009a1';
const M = 'aaaaaaaa-0000-4000-8000-0000000009a2';
const T = 'aaaaaaaa-0000-4000-8000-00000000d9a1'; // E1's, restricted to a2 — M is not on it

const probe = (uid: string, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, false)`);
function asUser(uid: string, query: string): string {
  const rows = sql(`begin;
    do $$ begin
      perform set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true);
      perform set_config('request.jwt.claim.sub', ${lit(uid)}, true);
    end $$;
    set local role authenticated;
    ${query};
    rollback;`);
  return rows.at(-1)?.[0] ?? '';
}

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
    from (values ('${E1}', 'q669a@isolation.invalid'), ('${M}', 'q669b@isolation.invalid')) as u(id, email)
    on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${E1}', 'editor'), ('${A}', '${M}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    insert into public.workspace_moderators (workspace_id, user_id) values ('${A}', '${M}') on conflict do nothing;
    update public.workspaces set moderation_new = true, moderation_changes = true where id = '${A}';
    insert into public.prompts (id, workspace_id, title, content, kind, created_by) values ('${T}', '${A}', 'restricted', 'x', 'skill', '${E1}') on conflict do nothing;
    update public.prompts set review_state = null where id = '${T}';
    insert into public.template_access (template_id, workspace_id, user_id) values ('${T}', '${A}', '${USERS.a2}');
    insert into public.pending_changes (workspace_id, kind, object_id, author, payload) values ('${A}', 'template', '${T}', '${E1}', '{"title": "proposed"}'::jsonb)
      on conflict (kind, object_id, author) do update set payload = excluded.payload, state = 'pending';
  `);
});

describe('SQEM-669 — the review list', () => {
  it('the moderator cannot open the playbook itself…', () => {
    expect(probe(M, `select id from public.prompts where id = '${T}'`)).toBe('rows=0');
  });
  it('…but finds the change in the list, marked as not openable', () => {
    const q = asUser(M, `select (x->>'title') || '|' || (x->>'type') || '|' || (x->>'can_open') from jsonb_array_elements(public.review_queue('${A}')) x where x->>'id' = '${T}'`);
    expect(q).toBe('restricted|change|false');
  });
  it('…and can read the released state to compare it', () => {
    const v = asUser(M, `select public.pending_change_released_state((select id from public.pending_changes where object_id = '${T}'))->>'title'`);
    expect(v).toBe('restricted');
  });
  it('⛔ a member, an editor who does not moderate, and another tenant get neither', () => {
    for (const uid of [USERS.a2, E1, USERS.b1]) {
      expect(probe(uid, `select public.review_queue('${A}')`), uid).toMatch(/^err=42501/);
      expect(probe(uid, `select public.pending_change_released_state((select id from public.pending_changes where object_id = '${T}' limit 1))`), uid).toMatch(/^err=42501/);
    }
  });
});
