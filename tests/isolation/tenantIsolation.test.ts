/**
 * SQEM-504 — tenant isolation, tested against a real (LOCAL) database.
 *
 * Tenant B's admin, B's member and an anonymous caller try to read, change, delete and plant rows of
 * tenant A in every table, in storage, and through every SECURITY DEFINER function a client may call.
 * Expected everywhere: nothing.
 *
 * ⛔ Two rules keep this from passing for the wrong reason:
 *   1. A's rows are found as `postgres` (RLS off) and pinned by `ctid`; only the probe runs as B.
 *      Finding them as B would let RLS hide exactly the leak the probe is looking for.
 *   2. Controls prove the probe can see something at all: B sees its own playbook, A's member sees
 *      A's open one. A probe that sees nothing for anyone would make every check below green.
 *
 * Run: `npx supabase start` once, then `npm run test:isolation`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql, one, lit } from './db';
import { OWNERSHIP, A, B, USERS } from './ownership';
import { DEFINER_ALLOWLIST } from './definerAllowlist';

const file = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

function probe(role: string, uid: string | null, stmt: string, count: boolean, setting?: string): string {
  return one(`select isolation_test.probe(${lit(role)}, ${uid ? `${lit(uid)}::uuid` : 'null'}, ${lit(stmt)}, ${count}${setting ? `, ${lit(setting)}` : ''})`);
}

/** Refused = no row visible/affected, or an outright permission error. */
const refused = (r: string) => r === 'rows=0' || r.startsWith('err=42501');

const TESTERS: Array<[label: string, role: string, uid: string | null]> = [
  ['b1 (admin of B)', 'authenticated', USERS.b1],
  ['b2 (member of B)', 'authenticated', USERS.b2],
  ['anon', 'anon', null],
];

const tidArray = (ctids: string[]) => `'{${ctids.map(c => `"${c}"`).join(',')}}'::tid[]`;

function columns(schema: string, table: string): string[] {
  return sql(`select column_name from information_schema.columns where table_schema = ${lit(schema)} and table_name = ${lit(table)} order by ordinal_position`).map(r => r[0]);
}

/** A copy of one of A's rows, rewritten so B tries to plant it as its own (new id, B as author). */
function plantedCopy(schema: string, table: string, ctid: string, uid: string): string {
  const row = JSON.parse(one(`select row_to_json(t) from ${schema}.${table} t where ctid = '${ctid}'`));
  const cols = columns(schema, table);
  // Generated columns (e.g. storage.objects.path_tokens) cannot be written; leaving them in makes the
  // insert fail with 428C9 before any policy is asked.
  // Read from pg_attribute: information_schema hides columns of tables `postgres` does not own (storage).
  const generated = sql(`select attname from pg_attribute where attrelid = '${schema}.${table}'::regclass and attnum > 0 and not attisdropped and (attgenerated <> '' or attidentity = 'a')`).map(r => r[0]);
  for (const g of generated) delete row[g];
  if (cols.includes('id')) row.id = one('select gen_random_uuid()');
  for (const c of ['user_id', 'created_by', 'invited_by', 'owner']) if (cols.includes(c) && row[c] != null) row[c] = uid;
  if (schema === 'storage' && table === 'objects') row.name = `${A}/planted-by-b/${row.id}.md`;
  // Explicit column list: `select *` would hand the generated columns an explicit NULL (428C9).
  const writable = sql(`select attname from pg_attribute where attrelid = '${schema}.${table}'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a' order by attnum`).map(r => `"${r[0]}"`).join(', ');
  return `insert into ${schema}.${table} (${writable}) select ${writable} from json_populate_record(null::${schema}.${table}, ${lit(JSON.stringify(row))}::json)`;
}

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
});

describe('SQEM-504 — guards (fail when the schema changes unclassified)', () => {
  it('⛔ every table in public is classified in ownership.ts', () => {
    const tables = sql(`select tablename from pg_tables where schemaname = 'public' order by 1`).map(r => r[0]);
    expect(tables.filter(t => !OWNERSHIP[t]), 'classify these tables in tests/isolation/ownership.ts').toEqual([]);
    expect(Object.keys(OWNERSHIP).filter(t => !tables.includes(t)), 'remove tables that no longer exist').toEqual([]);
  });

  it('⛔ every table in public has RLS enabled', () => {
    expect(sql(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`).map(r => r[0])).toEqual([]);
  });

  it('⛔ client-callable SECURITY DEFINER functions are exactly the allowlist', () => {
    const callable = sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
      order by 1`).map(r => r[0]);
    expect(callable.filter(f => !DEFINER_ALLOWLIST[f]), 'revoke client EXECUTE in the migration, or list it with a reason').toEqual([]);
    expect(Object.keys(DEFINER_ALLOWLIST).filter(f => !callable.includes(f)), 'no longer callable — remove from the allowlist').toEqual([]);
  });
});

describe('SQEM-504 — controls (the probe can see what it should)', () => {
  it('B sees its own playbook; A\'s member sees A\'s open one and not the "Only me" one', () => {
    expect(probe('authenticated', USERS.b2, `select count(*) from public.prompts where workspace_id = '${B}'`, true)).toBe('rows=1');
    expect(probe('authenticated', USERS.a2, `select count(*) from public.prompts where id = 'aaaaaaaa-0000-4000-8000-00000000a001'`, true)).toBe('rows=1');
    expect(probe('authenticated', USERS.a2, `select count(*) from public.prompts where id = 'aaaaaaaa-0000-4000-8000-00000000a002'`, true)).toBe('rows=0');
  });

  it('A\'s member does not see A\'s admin\'s private chat or its messages', () => {
    expect(probe('authenticated', USERS.a2, `select count(*) from public.chat_sessions where id = 'aaaaaaaa-0000-4000-8000-00000000a401'`, true)).toBe('rows=0');
    expect(probe('authenticated', USERS.a2, `select count(*) from public.chat_messages where session_id = 'aaaaaaaa-0000-4000-8000-00000000a401'`, true)).toBe('rows=0');
  });
});

describe('SQEM-504 — no other tenant can read, change, delete or plant A\'s rows', () => {
  for (const [table, own] of Object.entries(OWNERSHIP)) {
    it(table, () => {
      const where = `(${own.ownedByA})${own.publicByDesign ? ` and not (${own.publicByDesign})` : ''}`;
      const ctids = sql(`select ctid::text from public.${table} t where ${where}`).map(r => r[0]);
      if (ctids.length === 0) {
        expect(own.mayBeEmpty, `the seed created no row of A in ${table} — seed one, or say why it may be empty`).toBeTruthy();
        return;
      }
      const arr = tidArray(ctids);
      const first = columns('public', table)[0];
      const failures: string[] = [];
      for (const [label, role, uid] of TESTERS) {
        const read = probe(role, uid, `select count(*) from public.${table} where ctid = any(${arr})`, true);
        if (!refused(read)) failures.push(`${label} READ ${read}`);
        const upd = probe(role, uid, `update public.${table} set "${first}" = "${first}" where ctid = any(${arr})`, false);
        if (!refused(upd)) failures.push(`${label} UPDATE ${upd}`);
        const del = probe(role, uid, `delete from public.${table} where ctid = any(${arr})`, false);
        if (!refused(del)) failures.push(`${label} DELETE ${del}`);
        if (own.insertAs === 'workspace' && uid) {
          const ins = probe(role, uid, plantedCopy('public', table, ctids[0], uid), false);
          // Only a permission refusal counts. A unique or FK error means the row never reached the
          // policy, so nothing was tested — fail, so the probe gets fixed rather than trusted.
          if (!ins.startsWith('err=42501')) failures.push(`${label} INSERT into A: ${ins}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('SQEM-504 — storage', () => {
  it('no other tenant can read, change, delete or upload into A\'s folder', () => {
    const ctids = sql(`select ctid::text from storage.objects where bucket_id = 'workspace-files' and name like '${A}/%'`).map(r => r[0]);
    expect(ctids.length, 'the seed must create an object in A\'s folder').toBeGreaterThan(0);
    const arr = tidArray(ctids);
    const failures: string[] = [];
    for (const [label, role, uid] of TESTERS) {
      const read = probe(role, uid, `select count(*) from storage.objects where ctid = any(${arr})`, true);
      if (!refused(read)) failures.push(`${label} READ ${read}`);
      const upd = probe(role, uid, `update storage.objects set name = name where ctid = any(${arr})`, false);
      if (!refused(upd)) failures.push(`${label} UPDATE ${upd}`);
      // storage.protect_delete() refuses every direct delete with 42501 unless this is set — which
      // would make the probe pass without RLS being asked.
      const del = probe(role, uid, `delete from storage.objects where ctid = any(${arr})`, false, 'storage.allow_delete_query=true');
      if (!refused(del)) failures.push(`${label} DELETE ${del}`);
      if (uid) {
        const ins = probe(role, uid, plantedCopy('storage', 'objects', ctids[0], uid), false);
        if (!ins.startsWith('err=42501')) failures.push(`${label} UPLOAD into A: ${ins}`);
      }
    }
    // Control: A's admin may delete A's own object (rolled back), so the probe is not blind.
    expect(probe('authenticated', USERS.a1, `delete from storage.objects where ctid = any(${arr})`, false, 'storage.allow_delete_query=true')).toBe(`rows=${ctids.length}`);
    expect(failures).toEqual([]);
  });
});

describe('SQEM-504 — client-callable SECURITY DEFINER functions with A\'s ids', () => {
  for (const [fn, entry] of Object.entries(DEFINER_ALLOWLIST)) {
    if (!entry.probe) continue;
    it(fn, () => {
      for (const [label, role, uid] of TESTERS.filter(t => t[2])) {
        const r = probe(role, uid, entry.probe!.sql, entry.probe!.expect !== 'error');
        // A missing function or table means the probe is stale, not that the call was refused.
        expect(r, `${label}: stale probe`).not.toMatch(/^err=(42883|42P01|42703)/);
        if (entry.probe!.expect === 'zero') expect(r, label).toBe('rows=0');
        if (entry.probe!.expect === 'error') expect(r, label).toMatch(/^err=/);
        if (entry.probe!.expect === 'zeroOrError') expect(r === 'rows=0' || r.startsWith('err='), `${label}: ${r}`).toBe(true);
      }
    });
  }
});
