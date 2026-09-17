import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-434 — the AI-credit month follows Stripe's billing cycle.
 *
 * ⛔ The load-bearing decision is **which Stripe field**. Credits reset monthly; a subscription can be
 * yearly. `current_period_start` moves with the invoice, so on a yearly plan it advances once a year
 * and that customer would get their credits back once a year. `billing_cycle_anchor` is fixed and
 * survives renewals. Swapping the two is a change nobody would notice for eleven months.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const SQL = read('supabase/migrations/20260917150000_sqem434_credit_period_billing_anchor.sql');
const HOOK = read('supabase/functions/stripe-webhook/index.ts');

describe('SQEM-434 — credit period anchored to Stripe', () => {
  it('⛔ the anchor is billing_cycle_anchor, never current_period_start', () => {
    expect(HOOK).toMatch(/subscription\.billing_cycle_anchor/);
    // ⚠️ The USE, not the word — the comment above it has to name the field it warns against.
    expect(HOOK).not.toMatch(/subscription\.current_period_start/);
    expect(SQL).toMatch(/billing_cycle_anchor timestamptz/);
  });

  it('⛔ a missing anchor never overwrites a stored one', () => {
    // Writing null over an anchor would silently drop the workspace back onto the drifting fallback,
    // and nothing about the behaviour would say so.
    expect(HOOK).toMatch(/\.\.\.\(anchor \? \{ billing_cycle_anchor: anchor \} : \{\}\)/);
  });

  it('⛔ the reset stays ONE statement — a read-then-write would be racy', () => {
    // Two concurrent calls could both decide a reset is due, and the second would wipe a debit made
    // between them. The condition and the write belong in the same UPDATE, as they always were.
    const fn = SQL.slice(SQL.indexOf('create or replace function public.ensure_credit_period'));
    const body = fn.slice(0, fn.lastIndexOf('$$;'));
    expect(body).toMatch(/language sql/);
    expect((body.match(/update public\.workspaces/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/\bselect\b[\s\S]*\binto\b/i);
  });

  it('⚠️ a workspace without an anchor keeps the old behaviour', () => {
    // The changeover has no script and no Stripe key outside the webhook: every workspace gets an
    // anchor at its next renewal event, and drifts exactly as before until then.
    expect(SQL).toMatch(/coalesce\(\s*public\.credit_period_anchor\(w\.billing_cycle_anchor, now\(\)\),\s*now\(\) - interval '1 month'/);
  });

  it('⚠️ an anchor in the future yields no boundary', () => {
    // A negative age() would otherwise produce a boundary in the past — and reset the allowance on
    // every single call.
    expect(SQL).toMatch(/when anchor is null or anchor > at then null/);
  });

  it('the boundary is a whole number of months after the anchor', () => {
    // Month-ends clamp the way Stripe clamps them (Jan 31 + 1 month = Feb 28), which is why this is
    // month arithmetic and not a day count.
    expect(SQL).toMatch(/make_interval\(months =>/);
    expect(SQL).toMatch(/extract\(year from age\(at, anchor\)\)::int \* 12/);
  });

  it('⚠️ the one-off extra reset is written down, not discovered later', () => {
    // A workspace whose period start sits before its anchor day crosses the new boundary at once.
    // Bounded (once per workspace) and in the customer's favour — but it must not read as a bug.
    expect(SQL).toMatch(/can grant ONE extra reset/);
  });
});
