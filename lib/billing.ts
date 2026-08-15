import { supabase } from './supabase';
import type { PlanTier } from '../types';

export type BillingCycle = 'monthly' | 'yearly';

/**
 * SQEM-209 — the one place that opens Stripe checkout.
 *
 * `create-checkout-session` needs an existing `workspaceId`: it goes into the Stripe metadata
 * (`{ workspace_id, plan, billing_cycle }`) and is what the webhook later matches the subscription
 * back to. That constraint is the reason a workspace cannot be created *after* payment — it has to
 * exist first, which is why the create-workspace flow now creates the row as late as possible,
 * immediately before this call.
 *
 * Redirects on success and therefore never returns; throws with the server's message otherwise.
 */
export async function startCheckout(workspaceId: string, plan: PlanTier, billingCycle: BillingCycle): Promise<never> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ workspaceId, plan, billingCycle }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to start checkout');

  window.location.href = data.url;
  // The redirect is asynchronous; keep the caller's loading state up rather than letting it
  // flash back to idle while the browser is already navigating away.
  return new Promise<never>(() => {});
}
