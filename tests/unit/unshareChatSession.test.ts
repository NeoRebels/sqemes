import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-357 — an admin may withdraw a shared chat, and must never be able to publish a private one.
 *
 * ⛔ The direction is the whole point. Withdrawing is a **reduction**; sharing is a **disclosure**,
 * and an admin who could make a colleague's private conversation visible would hold a completely
 * different power from one who takes back a sharing that already happened.
 *
 * ⚠️ Read as text: this is SQL, and the property worth protecting is structural — that the function
 * takes no target value and refuses anything not already shared. A behavioural test would need a
 * database; the migration carries its own self-test for that.
 */
const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260910060000_sqem357_unshare_chat_session.sql'),
  'utf8',
);

/** Strip comments so prose describing the rule never counts as the rule. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
}

describe('withdrawing a shared chat goes one way only (SQEM-357)', () => {
  const sql = code(SQL);

  it('takes no target visibility — the direction is not a parameter', () => {
    // ⛔ `p_visibility` would be the convenient signature and exactly how the other direction later
    // gets "just passed through" by someone who only needed a small favour.
    const signature = sql.match(/create or replace function public\.unshare_chat_session\(([\s\S]*?)\)/);
    expect(signature, 'the function was not found — was it renamed?').toBeTruthy();
    expect(signature![1]).toContain('p_session_id uuid');
    expect(signature![1], 'the target visibility must not be caller-supplied').not.toMatch(/visibilit/i);
  });

  it('only ever writes private, never workspace', () => {
    const updates = [...sql.matchAll(/update public\.chat_sessions[\s\S]*?set ([\s\S]*?)where/g)]
      .map(m => m[1]);
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(u).toMatch(/visibility\s*=\s*'private'/);
      expect(u, 'this function must never share anything').not.toMatch(/'workspace'/);
    }
  });

  it('refuses a session that is not shared', () => {
    // Without this it is a visibility setter with a misleading name — and the name is what the next
    // person will trust.
    expect(sql).toMatch(/if s\.visibility <> 'workspace' then[\s\S]{0,200}?raise exception/);
  });

  it('checks admin against the session own workspace, not any workspace', () => {
    // ⚠️ `get_user_role(s.workspace_id)`, not a bare membership test: an admin of some other
    // workspace must not reach into this one.
    expect(sql).toMatch(/get_user_role\(s\.workspace_id\)\s*<>\s*'admin'[\s\S]{0,160}?raise exception/);
  });

  it('leaves the expiry to the existing trigger', () => {
    // The 30-day countdown belongs to manage_chat_session_expiry(). Two places deciding one deadline
    // drift apart, and the shared-never-expires rule is exactly what made these artefacts permanent.
    expect(sql, 'expiry must not be set here').not.toMatch(/set[\s\S]{0,80}?expires_at/);
  });
});
