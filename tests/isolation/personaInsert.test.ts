import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A, B } from './ownership';

/**
 * SQEM-525 — a persona can be created from the browser again, and the SQEM-505 boundary still holds.
 *
 * The app writes with `insert(...).select()`, so the row comes back through RETURNING and must pass
 * `personas_select` → `can_access_persona`. Since SQEM-505 that function looked its own row up and could
 * not see the one being inserted: every browser insert failed with 42501 (measured 2026-10-19).
 * Probes run one statement as a role and roll it back (isolation_test.probe).
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const A_PERSONA = 'aaaaaaaa-0000-4000-8000-00000000a101';
const probe = (uid: string, stmt: string, count: boolean) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, ${count})`);
const insertReturning = (ws: string) =>
  `with i as (insert into public.personas (workspace_id, title) values ('${ws}', 'probe') returning id) select count(*) from i`;

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
});

describe('SQEM-525 — creating a persona the way the app does', () => {
  it('⛔ an admin creates one with RETURNING (createPersona uses insert().select())', () => {
    expect(probe(USERS.a1, insertReturning(A), true)).toBe('rows=1');
  });

  it('a member still may not create one (personas_insert, unchanged)', () => {
    expect(probe(USERS.a2, insertReturning(A), true)).toMatch(/^err=42501/);
  });

  it('nobody creates one in a workspace they are not in', () => {
    expect(probe(USERS.b1, insertReturning(A), true)).toMatch(/^err=42501/);
  });
});

describe('SQEM-525 — the SQEM-505 boundary still holds', () => {
  it('⛔ an admin of another workspace cannot see A\'s persona', () => {
    expect(probe(USERS.b1, `select count(*) from public.personas where id = '${A_PERSONA}'`, true)).toBe('rows=0');
  });

  it('⛔ nor by calling the function with themselves as creator', () => {
    const r = probe(USERS.b1, `select count(*) from (select 1 where public.can_access_persona('${A_PERSONA}', '${USERS.b1}')) x`, true);
    expect(r, r).toMatch(/^(rows=0|err=42501)/); // false, or not executable at all
  });

  it('its own members still see it', () => {
    expect(probe(USERS.a1, `select count(*) from public.personas where id = '${A_PERSONA}'`, true)).toBe('rows=1');
  });

  void B;
});
