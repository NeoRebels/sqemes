import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS, A, B } from './ownership';

/**
 * SQEM-512 — the file list checks access once per query (accessible_file_ids) instead of once per row
 * (can_access_file), with the same answer for every person and every file.
 *
 * Extra files beside the seed, one per way a file can be visible or not:
 *   PRIVATE   — a1's, listed only by "A only me" (a1 alone may open it)   → a1 yes, a2 no
 *   ADMINLIST — ownerless, listed only by a template for admins           → a1 yes, a2 no
 *   MEMBERUP  — a2's own upload, listed nowhere                           → a2 yes, a1 no (not ownerless)
 *   BFILE     — B's, listed by a template of A (a forged id)              → nobody in A; B's members by role
 * plus the seed's a.md (listed by the open template) and orphan.md (ownerless, unlisted: admin only).
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const id = (n: string) => `aaaaaaaa-0000-4000-8000-00000000a${n}`;
const PRIVATE = id('311'), ADMINLIST = id('312'), MEMBERUP = id('313'), BFILE = 'bbbbbbbb-0000-4000-8000-00000000b311';
const A_OPEN = id('001'), A_ONLY_ME = id('002'), A_ADMINS = id('003');
const ALL_USERS = Object.values(USERS);

const probe = (uid: string, stmt: string, count = true) =>
  one(`select isolation_test.probe('authenticated', ${lit(uid)}::uuid, ${lit(stmt)}, ${count})`);
const sees = (uid: string, fileId: string) =>
  probe(uid, `select count(*) from public.workspace_files where id = '${fileId}'`) === 'rows=1';
const fileRow = (fid: string, ws: string, by: string | null, name: string) =>
  `insert into public.workspace_files (id, workspace_id, name, mime_type, size_bytes, storage_path, created_by)
   values ('${fid}', '${ws}', '${name}', 'text/markdown', 1, '${ws}/${fid}/${name}', ${by ? `'${by}'` : 'null'});`;

/** What can_access_file says, evaluated for `uid` (as postgres, with the caller's claims, rolled back). */
function expected(uid: string): Map<string, boolean> {
  const rows = sql(`begin;
select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: uid, role: 'authenticated' }))}, true) is not null;
select f.id, coalesce(public.can_access_file(f.id, f.workspace_id, f.created_by), false)
  from public.workspace_files f where f.workspace_id in ('${A}', '${B}');
rollback;`).filter(r => r.length === 2);
  return new Map(rows.map(([f, v]) => [f, v === 't']));
}

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`
    insert into public.prompts (id, workspace_id, title, content, kind, created_by, published)
      values ('${A_ADMINS}', '${A}', 'A admins', 'x', 'prompt', '${USERS.a1}', true);
    insert into public.template_access (template_id, workspace_id, role, created_by)
      values ('${A_ADMINS}', '${A}', 'admin', '${USERS.a1}');
    ${fileRow(PRIVATE, A, USERS.a1, 'private.md')}
    ${fileRow(ADMINLIST, A, null, 'adminlist.md')}
    ${fileRow(MEMBERUP, A, USERS.a2, 'memberup.md')}
    ${fileRow(BFILE, B, USERS.b1, 'b.md')}
    update public.prompts set context_file_ids = array['${PRIVATE}'::uuid] where id = '${A_ONLY_ME}';
    update public.prompts set context_file_ids = array['${ADMINLIST}'::uuid] where id = '${A_ADMINS}';
    -- A forged reference: A's open template names B's file. It must not reach anyone through A.
    update public.prompts set context_file_ids = context_file_ids || '${BFILE}'::uuid where id = '${A_OPEN}';
  `);
});

describe('SQEM-512 — the new rule gives the same answer as can_access_file', () => {
  it('⛔ for every person and every file of both workspaces', () => {
    const differences: string[] = [];
    let compared = 0;
    for (const uid of ALL_USERS) {
      for (const [fid, want] of expected(uid)) {
        compared++;
        if (sees(uid, fid) !== want) differences.push(`${uid} / ${fid}: expected ${want}`);
      }
    }
    expect(compared).toBe(ALL_USERS.length * 6); // a.md, orphan.md and the four above
    expect(differences).toEqual([]);
  });

  it('and the cases it is built from hold, spelled out', () => {
    expect([sees(USERS.a1, PRIVATE), sees(USERS.a2, PRIVATE)]).toEqual([true, false]);
    expect([sees(USERS.a1, ADMINLIST), sees(USERS.a2, ADMINLIST)]).toEqual([true, false]);
    expect([sees(USERS.a1, MEMBERUP), sees(USERS.a2, MEMBERUP)]).toEqual([false, true]);
    expect([sees(USERS.a1, BFILE), sees(USERS.a2, BFILE)]).toEqual([false, false]);
    expect(sees(USERS.b1, BFILE)).toBe(true);
    expect(sees(USERS.b1, PRIVATE)).toBe(false);
  });

  it('⛔ accessible_file_ids answers only for the caller — B sees none of A\'s ids through it', () => {
    expect(probe(USERS.b2, `select count(*) from public.accessible_file_ids() f where f in ('${PRIVATE}', '${ADMINLIST}', '${id('301')}')`)).toBe('rows=0');
  });
});

describe('SQEM-512 — the SQEM-525 trap', () => {
  const upload = `with i as (insert into public.workspace_files (workspace_id, name, mime_type, size_bytes, storage_path)
    values ('${A}', 'new.md', 'text/markdown', 1, '${A}/new/new.md') returning id) select count(*) from i`;

  it('⛔ an admin uploads the way the app does (insert().select() → RETURNING) and gets the row back', () => {
    expect(probe(USERS.a1, upload)).toBe('rows=1');
  });

  it('…and the test can tell: with the uploader check moved into the set (the ticket\'s first draft), the same upload fails', () => {
    // The first draft: one definer set holding all three clauses, and the policy only asking `id in (set)`.
    const out = sql(`begin;
      create or replace function public.accessible_file_ids() returns setof uuid language sql stable security definer
        set search_path to 'public' as $f$
        select f.id from public.workspace_files f
         where f.workspace_id in (select public.get_user_workspace_ids()) and f.created_by = auth.uid() $f$;
      drop policy "workspace_files_select" on public.workspace_files;
      create policy "workspace_files_select" on public.workspace_files for select to authenticated
        using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
               and id in (select public.accessible_file_ids()));
      select isolation_test.probe('authenticated', '${USERS.a1}'::uuid, ${lit(upload)}, true);
      rollback;`);
    expect(out.flat().join(' ')).toMatch(/err=42501/);
  });
});

describe('SQEM-512 — the equality test is not vacuous (mutation probe)', () => {
  it('dropping the admin-orphan clause from the set hides orphan.md from A\'s admin', () => {
    const out = sql(`begin;
      create or replace function public.accessible_file_ids() returns setof uuid language sql stable security definer
        set search_path to 'public' as $f$
        select f.id from (select p.workspace_id, unnest(p.context_file_ids) as fid from public.prompts p
                           where p.workspace_id in (select public.get_user_workspace_ids())
                             and public.can_access_template(p.id, p.workspace_id, p.created_by)) listed
          join public.workspace_files f on f.id = listed.fid and f.workspace_id = listed.workspace_id $f$;
      select isolation_test.probe('authenticated', '${USERS.a1}'::uuid, 'select count(*) from public.workspace_files where id = ''${id('302')}''', true);
      rollback;`);
    expect(out.flat().join(' ')).toContain('rows=0');
    expect(sees(USERS.a1, id('302'))).toBe(true); // and back to normal once rolled back
  });
});

describe('SQEM-512 — the set is computed once, not per row', () => {
  it('the plan holds no per-row call of can_access_file', () => {
    const plan = sql(`begin;
      select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: USERS.a2, role: 'authenticated' }))}, true) is not null;
      set local role authenticated;
      explain select * from public.workspace_files where workspace_id = '${A}';
      rollback;`).flat().join('\n');
    expect(plan).not.toContain('can_access_file');
    expect(plan).toMatch(/hashed SubPlan|InitPlan|Hash (Semi |Right Semi )?Join/);
  });
});
