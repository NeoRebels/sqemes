import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A } from './ownership';

/**
 * SQEM-477 — version history for playbooks. Versions are written by a trigger on `prompts`, are
 * visible exactly when the playbook is, and are restored through an INVOKER function so that the
 * edit right (SQEM-473) is the only rule that decides it.
 *
 * Probes run one statement as a role and roll it back (isolation_test.probe). `inTx` runs several
 * statements as one user and rolls them back too, returning the rows of the last SELECT.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const T_OPEN = 'aaaaaaaa-0000-4000-8000-00000000a001';   // a1's, visible to a2; lists a.md
const T_ONLY_ME = 'aaaaaaaa-0000-4000-8000-00000000a002'; // a1's, "only me"
const FILE_OF_T = 'aaaaaaaa-0000-4000-8000-00000000a301';

const probe = (uid: string | null, stmt: string, count = false, role = 'authenticated') =>
  one(`select isolation_test.probe(${lit(role)}, ${uid ? `${lit(uid)}::uuid` : 'null'}, ${lit(stmt)}, ${count})`);

function inTx(uid: string | null, role: string, stmts: string, finalSelect: string): string[][] {
  const claims = uid ? JSON.stringify({ sub: uid, role }) : JSON.stringify({ role });
  return sql(`begin;
    do $$ begin
      perform set_config('request.jwt.claims', ${lit(claims)}, true);
      perform set_config('request.jwt.claim.sub', ${lit(uid ?? '')}, true);
      perform set_config('request.jwt.claim.role', ${lit(role)}, true);
    end $$;
    set local role ${role};
    ${stmts}
    ${finalSelect};
    rollback;`);
}

const versionId = (template: string, version: number) =>
  one(`select id from public.template_versions where template_id = '${template}' and version = ${version}`);

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
});

describe('SQEM-477 — what the trigger records', () => {
  it('the seed already has a history: created (1), then a file attached (2), with the file\'s name', () => {
    expect(one(`select string_agg(version::text, ',' order by version) from public.template_versions where template_id = '${T_OPEN}'`)).toBe('1,2');
    expect(one(`select context_files::text from public.template_versions where template_id = '${T_OPEN}' and version = 2`))
      .toBe(`[{"id": "${FILE_OF_T}", "name": "a.md"}]`);
  });
  it('⛔ a counter or favourite write records nothing', () => {
    const rows = inTx(null, 'postgres', `update public.prompts set usage_count = usage_count + 1, is_favorite = not coalesce(is_favorite, false) where id = '${T_OPEN}';`,
      `select count(*) from public.template_versions where template_id = '${T_OPEN}'`);
    expect(rows.at(-1)?.[0]).toBe('2');
  });
  it('an app save records a version by the person who saved — the client cannot name someone else', () => {
    const rows = inTx(USERS.a1, 'authenticated',
      `update public.prompts set content = 'changed', updated_by = '${USERS.a2}' where id = '${T_OPEN}';`,
      `select version || ':' || created_by from public.template_versions where template_id = '${T_OPEN}' order by version desc limit 1`);
    expect(rows.at(-1)?.[0]).toBe(`3:${USERS.a1}`);
  });
  it('a service write (the MCP server) records the author it names', () => {
    const rows = inTx(null, 'service_role',
      `update public.prompts set title = 'via mcp', updated_by = '${USERS.a2}' where id = '${T_OPEN}';`,
      `select created_by from public.template_versions where template_id = '${T_OPEN}' order by version desc limit 1`);
    expect(rows.at(-1)?.[0]).toBe(USERS.a2);
  });
  it('⛔ a playbook created the way the app does (insert().select()) comes back, with version 1', () => {
    const create = `with i as (insert into public.prompts (workspace_id, title, content, kind) values ('${A}', 'new', 'x', 'prompt') returning id) select count(*) from i`;
    expect(probe(USERS.a1, create, true)).toBe('rows=1');
    const rows = inTx(USERS.a1, 'authenticated',
      `insert into public.prompts (id, workspace_id, title, content, kind) values ('aaaaaaaa-0000-4000-8000-00000000a0f1', '${A}', 'new', 'x', 'prompt');`,
      `select version || ':' || created_by from public.template_versions where template_id = 'aaaaaaaa-0000-4000-8000-00000000a0f1'`);
    expect(rows.at(-1)?.[0]).toBe(`1:${USERS.a1}`);
  });
});

describe('SQEM-477 — who sees and changes versions', () => {
  it('whoever sees the playbook sees its history; nobody else does', () => {
    expect(probe(USERS.a2, `select count(*) from public.template_versions where template_id = '${T_OPEN}'`, true)).toBe('rows=2');
    expect(probe(USERS.a2, `select count(*) from public.template_versions where template_id = '${T_ONLY_ME}'`, true)).toBe('rows=0');
    expect(probe(USERS.b1, `select count(*) from public.template_versions where workspace_id = '${A}'`, true)).toBe('rows=0');
  });
  it('⛔ no client writes a version itself', () => {
    expect(probe(USERS.a1, `insert into public.template_versions (template_id, workspace_id, version) values ('${T_OPEN}', '${A}', 99)`)).toMatch(/^err=42501/);
    expect(probe(USERS.a1, `update public.template_versions set content = 'forged' where template_id = '${T_OPEN}'`)).toMatch(/^err=42501/);
  });
  it('deleting an old version needs the edit right; the current one cannot be deleted', () => {
    expect(probe(USERS.a2, `delete from public.template_versions where template_id = '${T_OPEN}' and version = 1`)).toBe('rows=0');
    expect(probe(USERS.a1, `delete from public.template_versions where template_id = '${T_OPEN}' and version = 1`)).toBe('rows=1');
    expect(probe(USERS.a1, `delete from public.template_versions where template_id = '${T_OPEN}' and version = 2`)).toMatch(/^err=42501 The current version/);
  });
  it('deleting the playbook takes its whole history with it', () => {
    expect(probe(USERS.a1, `delete from public.prompts where id = '${T_OPEN}'`)).toBe('rows=1');
  });
});

describe('SQEM-477 — restoring', () => {
  it('⛔ a member cannot restore (no edit right); a foreign tenant cannot even find the version', () => {
    expect(probe(USERS.a2, `select public.restore_template_version('${versionId(T_OPEN, 1)}')`)).toMatch(/^err=42501 You may use this playbook but not change it/);
    expect(probe(USERS.b1, `select public.restore_template_version('${versionId(T_OPEN, 1)}')`)).toMatch(/^err=P0002/);
  });
  it('restoring writes a NEW version with a note, and leaves the old ones alone', () => {
    const rows = inTx(USERS.a1, 'authenticated',
      `select public.restore_template_version('${versionId(T_OPEN, 1)}');`,
      `select version || '|' || coalesce(note, '') || '|' || restored_from || '|' || jsonb_array_length(context_files) || '|' || created_by
         from public.template_versions where template_id = '${T_OPEN}' order by version desc limit 1`);
    expect(rows.at(-1)?.[0]).toBe(`3|Restored from version 1|1|0|${USERS.a1}`);
  });
  it('restoring the current state changes nothing and records nothing', () => {
    const rows = inTx(USERS.a1, 'authenticated', '', `select public.restore_template_version('${versionId(T_OPEN, 2)}')::text`);
    expect(rows.at(-1)?.[0]).toBe('{"version": null, "missingFiles": []}');
  });
  it('⛔ a file deleted since is not re-attached — and the answer says which one, by name', () => {
    sql(`update public.prompts set context_file_ids = '{}', content = 'later' where id = '${T_OPEN}';`); // v3: detached, rewritten
    try {
      const rows = inTx(USERS.a1, 'authenticated',
        `delete from public.workspace_files where id = '${FILE_OF_T}';`,
        `select public.restore_template_version('${versionId(T_OPEN, 2)}')::text`);
      expect(rows.at(-1)?.[0]).toBe('{"version": 4, "missingFiles": ["a.md"]}');
      // …while the file still exists, it comes back — even though nothing lists it any more
      const back = inTx(USERS.a1, 'authenticated', `select public.restore_template_version('${versionId(T_OPEN, 2)}');`,
        `select context_file_ids::text from public.prompts where id = '${T_OPEN}'`);
      expect(back.at(-1)?.[0]).toBe(`{${FILE_OF_T}}`);
    } finally {
      sql(file('./seed.sql'));
    }
  });
  it('⛔ which files are present is answered only for a version the caller can see', () => {
    expect(probe(USERS.b1, `select count(*) from public.template_version_files_present('${versionId(T_OPEN, 2)}')`, true)).toBe('rows=0');
    expect(probe(USERS.a2, `select count(*) from public.template_version_files_present('${versionId(T_OPEN, 2)}')`, true)).toBe('rows=1');
  });
});
