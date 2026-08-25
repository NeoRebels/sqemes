import { describe, it, expect } from 'vitest';
import {
  RETENTION_DAYS,
  WARN_LEAD_DAYS,
  startsRetentionClock,
  clearsRetentionClock,
  retentionAction,
} from '../../supabase/functions/_shared/retention';

// SQEM-269 — this module decides when paid customer data is destroyed, so every rule below is
// pinned rather than trusted. The two that matter most fail silently if they break: `past_due`
// starting the clock would put a recoverable card failure on a countdown, and a reactivated
// workspace still being deleted would take a paying customer's data with it.

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-25T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe('which statuses start and stop the clock', () => {
  it('starts on canceled and unpaid', () => {
    expect(startsRetentionClock('canceled')).toBe(true);
    expect(startsRetentionClock('unpaid')).toBe(true);
  });

  it('does NOT start on past_due — Stripe is still retrying the card', () => {
    // The single most consequential line in this file. past_due is the normal state of an expired
    // card that will be replaced next week; treating it as the end of the contract would schedule
    // deletion for customers who never left.
    expect(startsRetentionClock('past_due')).toBe(false);
  });

  it('does not start on an active or trialing subscription, or on none at all', () => {
    expect(startsRetentionClock('active')).toBe(false);
    expect(startsRetentionClock('trialing')).toBe(false);
    expect(startsRetentionClock(null)).toBe(false);
    expect(startsRetentionClock(undefined)).toBe(false);
  });

  it('clears only when the customer is actually back', () => {
    expect(clearsRetentionClock('active')).toBe(true);
    expect(clearsRetentionClock('trialing')).toBe(true);
    expect(clearsRetentionClock('past_due')).toBe(false);
    expect(clearsRetentionClock('canceled')).toBe(false);
    expect(clearsRetentionClock(null)).toBe(false);
  });
});

describe('what to do with a lapsed workspace', () => {
  it('waits while no clock has started', () => {
    // Every workspace that lapsed before this shipped arrives here with null until the migration
    // backfills it. Answering anything but "wait" would delete history on the first run.
    expect(retentionAction({ endedAt: null, warnedAt: null, now: NOW })).toBe('wait');
    expect(retentionAction({ endedAt: null, warnedAt: daysAgo(30), now: NOW })).toBe('wait');
  });

  it('waits through the export window and well beyond it', () => {
    expect(retentionAction({ endedAt: daysAgo(1), warnedAt: null, now: NOW })).toBe('wait');
    expect(retentionAction({ endedAt: daysAgo(30), warnedAt: null, now: NOW })).toBe('wait');
    expect(retentionAction({ endedAt: daysAgo(82), warnedAt: null, now: NOW })).toBe('wait');
  });

  it('warns once the lead time is reached', () => {
    expect(retentionAction({ endedAt: daysAgo(RETENTION_DAYS - WARN_LEAD_DAYS), warnedAt: null, now: NOW }))
      .toBe('warn');
  });

  it('does not warn twice', () => {
    expect(retentionAction({ endedAt: daysAgo(85), warnedAt: daysAgo(2), now: NOW })).toBe('wait');
  });

  it('deletes only after the full period AND a warning that had time to land', () => {
    expect(retentionAction({ endedAt: daysAgo(90), warnedAt: daysAgo(7), now: NOW })).toBe('delete');
  });

  it('refuses to delete when the period is up but nobody was warned', () => {
    // Reaching 90 days without a warning means the warning failed. Deleting anyway would be the
    // worst possible interpretation of "the period elapsed".
    expect(retentionAction({ endedAt: daysAgo(120), warnedAt: null, now: NOW })).toBe('warn');
  });

  it('refuses to delete when the warning is too fresh', () => {
    expect(retentionAction({ endedAt: daysAgo(95), warnedAt: daysAgo(1), now: NOW })).toBe('wait');
  });

  it('tolerates a cron that drifts by hours rather than deferring a whole day', () => {
    // Warned 6.5 days ago, period elapsed: a strict 7×24h would postpone this to tomorrow, and
    // then to the day after, every single time.
    const warned = new Date(NOW - 6.5 * DAY).toISOString();
    expect(retentionAction({ endedAt: daysAgo(91), warnedAt: warned, now: NOW })).toBe('delete');
  });
});
