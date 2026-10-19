import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, one, lit } from './db';
import { USERS } from './ownership';

/**
 * SQEM-519 — going live requires that a person reviewed the files, enforced by the database
 * (`guard_listing_review`), and the review itself is the server's. Probes run one statement as a role
 * and roll it back (isolation_test.probe). The moderator is a Sqemes admin for the duration of the file.
 */
const file = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const PENDING = 'aaaaaaaa-0000-4000-8000-00000000a601';
const ADMIN = USERS.b1; // made a Sqemes admin below; not a member of the listing's workspace
const probe = (role: string, uid: string | null, stmt: string, count: boolean) =>
  one(`select isolation_test.probe(${lit(role)}, ${uid ? `${lit(uid)}::uuid` : 'null'}, ${lit(stmt)}, ${count})`);
const set = (cols: string) => sql(`update public.library_templates set ${cols} where id = '${PENDING}'`);
const approve = (extra = '') => probe('authenticated', ADMIN,
  `with u as (update public.library_templates set status = 'published', published = true${extra} where id = '${PENDING}' returning reviewed_by)
   select count(*) from u where reviewed_by = '${ADMIN}'`, true);

beforeAll(() => {
  sql(file('./setup.sql'));
  sql(file('./seed.sql'));
  sql(`update public.profiles set is_sqemes_admin = true where id = '${ADMIN}'`);
});
afterAll(() => sql(`update public.profiles set is_sqemes_admin = false where id = '${ADMIN}'`));
afterEach(() => set(`needs_file_review = false, files_confirmed = false, scan_risk = null, review_note = null, status = 'pending', published = false`));

describe('SQEM-519 — approving a listing', () => {
  it('a text-only listing can be approved, and the database records who did it', () => {
    expect(approve()).toBe('rows=1');
  });

  it('⛔ a listing with scripts or binaries cannot go live until the files are confirmed', () => {
    set(`needs_file_review = true`);
    expect(approve()).toMatch(/^err=P0001.*confirm that you reviewed them/);
    expect(approve(', files_confirmed = true')).toBe('rows=1');
  });

  it('⛔ the same rule holds for the "Listed" toggle, which flips only `published`', () => {
    set(`needs_file_review = true`);
    expect(probe('authenticated', ADMIN, `update public.library_templates set published = true where id = '${PENDING}'`, false)).toMatch(/^err=P0001/);
  });

  it('⛔ a high-risk listing needs a written reason', () => {
    set(`scan_risk = 'high'`);
    expect(approve()).toMatch(/^err=P0001.*give a reason/);
    expect(approve(`, review_note = '   '`)).toMatch(/^err=P0001/);
    expect(approve(`, review_note = 'Scripts read only the input file; host is the vendor docs.'`)).toBe('rows=1');
  });

  it('a rejection records the reviewer too', () => {
    expect(probe('authenticated', ADMIN,
      `with u as (update public.library_templates set status = 'rejected' where id = '${PENDING}' returning reviewed_by) select count(*) from u where reviewed_by = '${ADMIN}'`, true)).toBe('rows=1');
  });
});

describe('SQEM-519 — the review is the server\'s', () => {
  it('⛔ an admin\'s client cannot clean a flagged listing before approving it', () => {
    set(`needs_file_review = true`);
    for (const col of [`needs_file_review = false`, `file_review = '{}'::jsonb`, `ai_review = '{"verdict":"no_concerns"}'::jsonb`, `bundle_hash = 'x'`, `scan_risk = 'low'`, `bundle_path = 'other/path.zip'`]) {
      expect(probe('authenticated', ADMIN, `update public.library_templates set ${col} where id = '${PENDING}'`, false), col).toMatch(/^err=42501/);
    }
  });

  it('⛔ the client cannot set reviewed_by / reviewed_at itself', () => {
    expect(probe('authenticated', ADMIN,
      `with u as (update public.library_templates set reviewed_by = '${USERS.a1}', review_note = 'x' where id = '${PENDING}' returning reviewed_by) select count(*) from u where reviewed_by is null`, true)).toBe('rows=1');
  });

  it('the service role (submit functions) writes the review', () => {
    expect(probe('service_role', null, `update public.library_templates set needs_file_review = true, bundle_hash = 'h' where id = '${PENDING}'`, false)).toBe('rows=1');
  });

  it('⛔ a non-admin cannot approve at all (RLS, unchanged)', () => {
    expect(probe('authenticated', USERS.a1, `update public.library_templates set status = 'published', published = true where id = '${PENDING}'`, false)).toBe('rows=0');
  });
});
