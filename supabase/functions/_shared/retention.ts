// SQEM-269 — when a lapsed workspace gets warned, and when it gets deleted.
//
// Pure on purpose, and free of Deno globals, so `tests/unit/retention.test.ts` can import it
// directly (the same arrangement `_shared/skillArchive.ts` already uses). **The rules below are the
// specification, and the tests are how it stays one** — both the Stripe webhook and the cleanup
// function read from here rather than restating the same conditions in two places.
//
// The timeline:
//
//   term ends ──┬── 0–30 days   the customer can still sign in and export everything (SQEM-267)
//               ├── ~83 days    warning email to every admin
//               └── 90 days     deletion
//
// Why a warning at all, when the terms already say 90 days: a card that fails while somebody is on
// holiday should not cost them their workspace in silence. `cleanup-abandoned-workspaces` warns for
// exactly that reason and refuses to delete until the warning has had time to be read — the same
// two-phase shape is reproduced here deliberately.

/** Total days from the end of the term until the workspace is deleted. Matches Terms § 8. */
export const RETENTION_DAYS = 90;

/** How long the customer keeps sign-in access to export. Informational here; enforced in the app. */
export const EXPORT_WINDOW_DAYS = 30;

/** The warning must be this old before a deletion may follow it. */
export const WARN_LEAD_DAYS = 7;

/**
 * Statuses that mean the contract is over and the clock should start.
 *
 * ⚠️ **`past_due` is deliberately absent.** Stripe sets it while it is still retrying the card — the
 * subscription is alive and usually recovers. Starting a 90-day deletion clock on a failed first
 * attempt would put real customer data on a countdown because of a expired card. `unpaid` is
 * different: by then Stripe has given up.
 */
export const CLOCK_STARTING_STATUSES = ['canceled', 'unpaid'] as const;

/** Statuses that mean the customer is back, and the clock must be cleared. */
export const CLOCK_CLEARING_STATUSES = ['active', 'trialing'] as const;

export function startsRetentionClock(status: string | null | undefined): boolean {
  return !!status && (CLOCK_STARTING_STATUSES as readonly string[]).includes(status);
}

export function clearsRetentionClock(status: string | null | undefined): boolean {
  return !!status && (CLOCK_CLEARING_STATUSES as readonly string[]).includes(status);
}

export type RetentionAction = 'wait' | 'warn' | 'delete';

/**
 * What to do with one lapsed workspace right now.
 *
 * `endedAt` null means the clock never started — **and that is the safe answer, not a missing one.**
 * Every workspace that lapsed before this shipped is backfilled at migration time with the migration's
 * own timestamp, so nothing inherits a date old enough to be deleted on the first run.
 */
export function retentionAction(
  { endedAt, warnedAt, now }: { endedAt: string | null; warnedAt: string | null; now: number },
): RetentionAction {
  if (!endedAt) return 'wait';

  const DAY_MS = 86_400_000;
  const daysSinceEnd = (now - new Date(endedAt).getTime()) / DAY_MS;
  if (daysSinceEnd < RETENTION_DAYS - WARN_LEAD_DAYS) return 'wait';

  if (!warnedAt) return 'warn';

  const daysSinceWarning = (now - new Date(warnedAt).getTime()) / DAY_MS;
  // The `- 1` mirrors `cleanup-abandoned-workspaces`: a daily cron drifts by a few hours, and
  // requiring a full 7×24h would push every deletion a day late, every time.
  if (daysSinceEnd >= RETENTION_DAYS && daysSinceWarning >= WARN_LEAD_DAYS - 1) return 'delete';

  return 'wait';
}
