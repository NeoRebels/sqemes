import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { A, B, USERS } from './ownership';

/**
 * SQEM-517 — usage counts in a real database: only the server writes, a playbook is only counted for
 * its own workspace, and clients cannot read or write the table.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const A_PROMPT = 'aaaaaaaa-0000-4000-8000-00000000a001';
const probe = (role: string, uid: string | null, stmt: string, count: boolean) =>
  one(`select isolation_test.probe(${lit(role)}, ${uid ? `${lit(uid)}::uuid` : 'null'}, ${lit(stmt)}, ${count})`);
const bump = (ws: string) => `select public.bump_usage('${ws}', 'extension', 'playbook_inserted', '${A_PROMPT}')`;
const countOf = (ws: string) => `select coalesce(sum(count), 0) from public.usage_daily where workspace_id = '${ws}' and channel = 'extension'`;

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
});

describe('SQEM-517 — who can count', () => {
  it('⛔ a client cannot call bump_usage', () => {
    expect(probe('authenticated', USERS.a1, bump(A), false)).toMatch(/^err=42501/);
    expect(probe('anon', null, bump(A), false)).toMatch(/^err=42501/);
  });
  it('the service role counts, one per call', () => {
    const before = Number(one(countOf(A)));
    sql(bump(A)); sql(bump(A));
    expect(Number(one(countOf(A)))).toBe(before + 2);
  });
  it('⛔ a playbook is never counted under another workspace', () => {
    sql(bump(B));
    expect(one(`select count(*) from public.usage_daily where workspace_id = '${B}'`)).toBe('0');
  });
  it('⛔ a client cannot read or write the table', () => {
    expect(probe('authenticated', USERS.a1, `select count(*) from public.usage_daily`, true)).toMatch(/^err=42501/);
    expect(probe('authenticated', USERS.a1, `insert into public.usage_daily (workspace_id, day, channel, action, template_id, count) values ('${A}', current_date, 'extension', 'playbook_inserted', '${A_PROMPT}', 1000)`, false)).toMatch(/^err=42501/);
  });
});
