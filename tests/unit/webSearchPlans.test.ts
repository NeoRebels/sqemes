import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLANS } from '../../constants';

/**
 * SQEM-594 (addendum) — included web searches per plan and credit period:
 * Solo 100, Team 1,000, Business 3,000, managed unlimited. The database decides
 * (web_search_allowance); constants.ts only displays — and the two must not drift.
 */
const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261026200000_sqem594_web_search_per_plan.sql'), 'utf8');
const allowance = (plan: string) => Number(new RegExp(`when p_plan = '${plan}' then (\\d+)`).exec(sql)?.[1]);

describe('web searches per plan', () => {
  it.each(['Solo', 'Team', 'Business'] as const)('%s: constants.ts shows what the database enforces', plan => {
    expect(PLANS[plan].webSearches).toBe(allowance(plan));
    expect(PLANS[plan].features).toContain(`${PLANS[plan].webSearches.toLocaleString('en-US')} web searches / month`);
  });

  it('the plan numbers', () => {
    expect([PLANS.Solo.webSearches, PLANS.Team.webSearches, PLANS.Business.webSearches]).toEqual([100, 1000, 3000]);
  });

  it('⛔ managed is unlimited, and the period is the AI-credit period', () => {
    expect(sql).toMatch(/when coalesce\(p_managed, false\) then null/);
    expect(sql).toMatch(/credits_period_start at time zone 'utc'\)::date/);
  });

  it('⛔ the counter is serialised per workspace and callable by the service role only', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\('web_search:' \|\| p_workspace_id::text\)\)/);
    expect(sql).toMatch(/revoke all on function public\.consume_web_search\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/drop function if exists public\.consume_web_search\(uuid, integer\)/);
  });

  it('the Overview read is for members of that workspace only', () => {
    expect(sql).toMatch(/m\.workspace_id = p_workspace_id and m\.user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/revoke all on function public\.workspace_web_search_usage\(uuid\) from public, anon/);
  });
});
