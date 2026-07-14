// SQEM-057 — subscription/trial state helpers. Solo is now paid, so "has access"
// is a real subscription check, not `plan === 'Solo'`. Managed workspaces are always
// active (outside the subscription model).
import type { Workspace } from '../types';

type WsLike = Pick<Workspace, 'isManaged' | 'subscriptionStatus' | 'trialEndsAt'>;

/** The workspace can use Cloud: managed, or an active/trialing Stripe subscription. */
export function hasActiveSubscription(ws: WsLike): boolean {
  return !!ws.isManaged || ws.subscriptionStatus === 'active' || ws.subscriptionStatus === 'trialing';
}

/** Currently in a free trial. */
export function isTrialing(ws: WsLike): boolean {
  return ws.subscriptionStatus === 'trialing';
}

/**
 * SQEM-083 — gate a non-managed Cloud workspace whenever it isn't active/trialing:
 * never-subscribed (`null`) OR lapsed (`canceled`/`past_due`/`unpaid`/`incomplete`).
 * Managed workspaces are exempt.
 * SQEM-056 — self-host (open core) has no subscription model, so the `VITE_SELF_HOSTED` build
 * flag disables this gate entirely (mirrors the server-side `SELF_HOSTED` bypass in
 * `_shared/subscription.ts`). Cloud never sets the flag.
 */
export function needsSubscriptionGate(ws: WsLike): boolean {
  if (import.meta.env.VITE_SELF_HOSTED === 'true') return false;
  return !ws.isManaged && !hasActiveSubscription(ws);
}

/**
 * Lapsed with a *live* subscription whose payment is failing → the fix is to update
 * the card via the Stripe portal, NOT a fresh checkout (which would duplicate the sub).
 */
export function isPaymentFailing(ws: WsLike): boolean {
  return ws.subscriptionStatus === 'past_due' || ws.subscriptionStatus === 'unpaid';
}

/** Whole days left in the trial (rounded up), or null when not trialing. */
export function trialDaysLeft(ws: WsLike): number | null {
  if (ws.subscriptionStatus !== 'trialing' || !ws.trialEndsAt) return null;
  const ms = new Date(ws.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
