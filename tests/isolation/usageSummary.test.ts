import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { A, B, USERS } from './ownership';

/**
 * SQEM-553 — the one way a client reads usage_daily: aggregates per channel for the admins and editors
 * of THAT workspace. The seed holds 3 MCP loads of a001 for A today; an editor is added here.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const EDITOR = 'aaaaaaaa-0000-4000-8000-0000000000e3';
const A_PROMPT = 'aaaaaaaa-0000-4000-8000-00000000a001';
const probe = (uid: string | null, stmt: string) =>
  one(`select isolation_test.probe('authenticated', ${uid ? `${lit(uid)}::uuid` : 'null'}, ${lit(stmt)}, true)`);
const total = (ws: string, days = 7) => `select coalesce(sum(uses), 0) from public.workspace_usage_summary('${ws}', ${days})`;

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', '${EDITOR}', 'authenticated', 'authenticated', 'e3@isolation.invalid', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
    insert into public.workspace_members (workspace_id, user_id, role) values ('${A}', '${EDITOR}', 'editor')
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    -- an old row outside any window, to prove the range is applied
    insert into public.usage_daily (workspace_id, day, channel, action, template_id, count)
      values ('${A}', (now() at time zone 'utc')::date - 200, 'mcp', 'playbook_loaded', '${A_PROMPT}', 1000)
      on conflict do nothing;
  `);
});

describe('SQEM-553 — workspace_usage_summary', () => {
  it("A's admin and editor read A's totals — the seeded 3, not the 200-day-old 1000", () => {
    expect(probe(USERS.a1, total(A))).toBe('rows=3');
    expect(probe(EDITOR, total(A))).toBe('rows=3');
    expect(probe(USERS.a1, `select count(*) from public.workspace_usage_summary('${A}') where channel = 'mcp' and top_template_id = '${A_PROMPT}' and top_uses = 3`)).toBe('rows=1');
  });

  it('p_days is clamped to 90: asking for 1000 days still leaves out the 200-day-old row', () => {
    expect(probe(USERS.a1, total(A, 1000))).toBe('rows=3');
  });

  it("⛔ refused: A's plain member, B's admin, B's member, and a call without a user", () => {
    for (const uid of [USERS.a2, USERS.b1, USERS.b2, null]) {
      expect(probe(uid, total(A))).toMatch(/^err=42501/);
    }
  });

  it('⛔ anon cannot execute it at all', () => {
    expect(one(`select isolation_test.probe('anon', null, ${lit(total(A))}, true)`)).toMatch(/^err=42501/);
  });

  it("B's admin reads B — and B has no usage, so zero rows, not A's", () => {
    expect(probe(USERS.b1, `select count(*) from public.workspace_usage_summary('${B}')`)).toBe('rows=0');
  });
});
