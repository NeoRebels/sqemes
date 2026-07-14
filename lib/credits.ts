// SQEM-082 — AI-credit display helpers (frontend).
// `credits_limit = 0` means unlimited. 1 credit = 1,000 tokens of the funded model.

export function isUnlimitedCredits(limit: number): boolean {
  return limit === 0;
}

export function creditsRemaining(used: number, limit: number): number {
  if (limit === 0) return Infinity;
  return Math.max(0, limit - used);
}

/** Whole-percent of the monthly allowance used (clamped 0–100). 0 for unlimited. */
export function creditsUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Tooltip text for the abstract usage indicator. */
export function creditsTooltip(used: number, limit: number): string {
  if (limit === 0) return 'Unlimited AI credits';
  const left = Math.max(0, limit - used);
  return `${left.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} credits left`;
}
