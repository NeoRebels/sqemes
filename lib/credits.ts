// SQEM-082 — AI-credit display helpers (frontend).
// `credits_limit = 0` means unlimited. 1 credit = 1,000 tokens of the funded model.

import { PLAN_AI_CREDITS } from '../constants';
import type { Workspace } from '../types';

/**
 * The monthly allowance to *display* for a workspace: the provisioned `credits_limit` if there is
 * one, otherwise the tier's decided allowance (display-only until a limit is provisioned).
 *
 * Managed workspaces deliberately return 0 — they are not metered, so quoting a tier number at them
 * would be a lie. 0 therefore means "show nothing", not "no credits".
 *
 * SQEM-201 — lifted out of `Dashboard.tsx` when the onboarding step started showing the same
 * number: two places computing a plan allowance from two expressions is how they end up disagreeing.
 */
export function includedCredits(ws: Pick<Workspace, 'creditsLimit' | 'isManaged' | 'plan'>): number {
  if (ws.creditsLimit > 0) return ws.creditsLimit;
  return ws.isManaged ? 0 : (PLAN_AI_CREDITS[ws.plan] ?? 0);
}

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
