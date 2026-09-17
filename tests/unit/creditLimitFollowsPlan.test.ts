import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAN_AI_CREDITS } from '../../constants';

/**
 * SQEM-433 — the AI-credit allowance follows the plan.
 *
 * It did not: `credits_limit` was written on INSERT and never again, so a workspace kept the
 * allowance of the tier it was **created** on. A Business workspace showed "Seats 1 / 30" (right —
 * seats come from the plan constant) beside "AI credits 24 / 5,000" (the frozen column), and since
 * `_shared/credits.ts` meters against that same column, the customer really was cut off at 5%.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const SQL = read('supabase/migrations/20260917140000_sqem433_credit_limit_follows_plan.sql');
const OLD = read('supabase/migrations/20260628130000_provision_credit_limits.sql');
const HOOK = read('supabase/functions/stripe-webhook/index.ts');

describe('SQEM-433 — credits_limit follows the plan', () => {
  it('⛔ the trigger fires on a PLAN change, and only on one', () => {
    expect(SQL).toMatch(/before update of plan on public\.workspaces/);
    // Without the WHEN clause every ordinary workspace update would re-provision the allowance.
    expect(SQL).toMatch(/when \(old\.plan is distinct from new\.plan\)/);
  });

  it('⛔ BEFORE, not AFTER — an AFTER trigger would update the row again and fire itself', () => {
    // The INSERT sibling does `UPDATE … WHERE id = new.id` from an AFTER trigger. Copying that shape
    // here means a statement that re-triggers; BEFORE assigns and is done.
    expect(SQL).toMatch(/new\.credits_limit := public\.plan_credit_limit\(new\.plan\)/);
    const fn = SQL.slice(SQL.indexOf('apply_plan_credit_limit_on_change()\nreturns trigger'));
    expect(fn.slice(0, fn.indexOf('$$;'))).not.toMatch(/update public\.workspaces/i);
  });

  it('⛔ a negotiated allowance survives an upgrade', () => {
    // The whole risk of this change: silently deleting a custom limit. Unlimited (0), managed
    // workspaces and any number that is not a known default are left alone.
    expect(SQL).toMatch(/if new\.is_managed then\n\s*return new;/);
    expect(SQL).toMatch(/coalesce\(new\.credits_limit, 0\) = 0 or not public\.is_default_credit_limit/);
  });

  it('⚠️ the historical Solo allowance counts as a default — those are the rows that need repair', () => {
    // 5000 was Solo's allowance before SQEM-130. Leaving it out would skip exactly the oldest
    // workspaces, which are the ones most likely to have drifted.
    expect(SQL).toMatch(/select v in \(2000, 5000, 25000, 100000\)/);
  });

  it('the defaults in the list match the tiers we actually sell', () => {
    const listed = SQL.match(/select v in \(([^)]+)\)/)![1].split(',').map((n) => Number(n.trim()));
    for (const credits of Object.values(PLAN_AI_CREDITS)) expect(listed).toContain(credits);
  });

  it('⚠️ the repair reports how many rows it changed', () => {
    // It moves billing-relevant numbers, and a deploy log only ever says "Remote database is up to
    // date" — the count is the only way to see what happened.
    expect(SQL).toMatch(/get diagnostics fixed = row_count/);
    expect(SQL).toMatch(/raise notice 'SQEM-433: re-provisioned credits_limit on % workspace\(s\)'/);
    // …and it does not touch rows that are already right.
    expect(SQL).toMatch(/credits_limit <> public\.plan_credit_limit\(plan\)/);
  });

  it('⛔ the rule stays in the database — no second copy in the webhook', () => {
    // The webhook is one of several paths that change a plan (manual SQL, a future admin screen).
    // A copy there is the one that drifts.
    expect(HOOK).not.toMatch(/credits_limit/);
    // The INSERT trigger stays; this is an addition, not a replacement.
    expect(OLD).toMatch(/AFTER INSERT ON public\.workspaces/);
  });
});
