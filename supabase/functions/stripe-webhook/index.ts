import { createAdminClient } from '../_shared/supabase-admin.ts';
import { timingSafeEqual } from '../_shared/timingSafe.ts';

const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

// Map Stripe price IDs to plan tiers
const PRICE_TO_PLAN: Record<string, 'Solo' | 'Team' | 'Business'> = {
  [Deno.env.get('STRIPE_SOLO_MONTHLY_PRICE_ID') ?? '']: 'Solo',
  [Deno.env.get('STRIPE_SOLO_YEARLY_PRICE_ID') ?? '']: 'Solo',
  [Deno.env.get('STRIPE_TEAM_MONTHLY_PRICE_ID') ?? '']: 'Team',
  [Deno.env.get('STRIPE_TEAM_YEARLY_PRICE_ID') ?? '']: 'Team',
  [Deno.env.get('STRIPE_BUSINESS_MONTHLY_PRICE_ID') ?? '']: 'Business',
  [Deno.env.get('STRIPE_BUSINESS_YEARLY_PRICE_ID') ?? '']: 'Business',
};

const PRICE_TO_CYCLE: Record<string, 'monthly' | 'yearly'> = {
  [Deno.env.get('STRIPE_SOLO_MONTHLY_PRICE_ID') ?? '']: 'monthly',
  [Deno.env.get('STRIPE_SOLO_YEARLY_PRICE_ID') ?? '']: 'yearly',
  [Deno.env.get('STRIPE_TEAM_MONTHLY_PRICE_ID') ?? '']: 'monthly',
  [Deno.env.get('STRIPE_TEAM_YEARLY_PRICE_ID') ?? '']: 'yearly',
  [Deno.env.get('STRIPE_BUSINESS_MONTHLY_PRICE_ID') ?? '']: 'monthly',
  [Deno.env.get('STRIPE_BUSINESS_YEARLY_PRICE_ID') ?? '']: 'yearly',
};

async function verifyStripeSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k] = v;
  }

  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return false;

  // Reject stale webhooks (> 5 minutes)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(computed, expectedSig);
}

Deno.serve(async (req) => {
  // Webhooks use POST only — no CORS preflight needed
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature') ?? '';
  const body = await req.text();

  const valid = await verifyStripeSignature(body, signature, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('stripe-webhook: invalid signature');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const adminClient = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const workspaceId = session.metadata?.workspace_id;
        const plan = session.metadata?.plan;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (!workspaceId || !plan) {
          console.error('stripe-webhook: missing workspace_id or plan in session metadata');
          break;
        }

        const billingCycle = session.metadata?.billing_cycle ?? 'monthly';
        await adminClient
          .from('workspaces')
          .update({
            plan,
            billing_cycle: billingCycle,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            // Every checkout starts a 14-day trial; subscription.created/updated refines
            // status + trial_ends_at. Set optimistically so the UI reflects it immediately.
            subscription_status: 'trialing',
            cancel_at_period_end: false,
          })
          .eq('id', workspaceId);

        console.log(`stripe-webhook: workspace ${workspaceId} subscribed to ${plan} (trialing)`);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const workspaceId = subscription.metadata?.workspace_id;

        if (!workspaceId) {
          console.error('stripe-webhook: missing workspace_id in subscription metadata');
          break;
        }

        const status = subscription.status; // trialing | active | past_due | canceled | ...
        const trialEnd = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null;

        const priceId = subscription.items?.data?.[0]?.price?.id;
        const plan = priceId ? PRICE_TO_PLAN[priceId] : undefined;
        const billingCycle = priceId ? (PRICE_TO_CYCLE[priceId] ?? 'monthly') : 'monthly';

        const update: Record<string, any> = {
          subscription_status: status,
          trial_ends_at: trialEnd,
          stripe_subscription_id: subscription.id,
          // Canceled-at-period-end keeps the sub trialing/active until the period ends.
          cancel_at_period_end: !!subscription.cancel_at_period_end,
        };
        // Only (re)assert the plan/cycle when the sub is usable and the price maps cleanly.
        if (['active', 'trialing'].includes(status) && plan) {
          update.plan = plan;
          update.billing_cycle = billingCycle;
        }

        await adminClient.from('workspaces').update(update).eq('id', workspaceId);

        console.log(`stripe-webhook: workspace ${workspaceId} subscription ${status}${plan ? ` (${plan})` : ''}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const workspaceId = subscription.metadata?.workspace_id;

        if (!workspaceId) {
          console.error('stripe-webhook: missing workspace_id in subscription metadata');
          break;
        }

        // Solo is paid now — a canceled sub does NOT fall back to a free plan. Mark the
        // workspace canceled (access is gated on subscription_status, not plan === 'Solo').
        await adminClient
          .from('workspaces')
          .update({
            subscription_status: 'canceled',
            stripe_subscription_id: null,
            cancel_at_period_end: false,
          })
          .eq('id', workspaceId);

        console.log(`stripe-webhook: workspace ${workspaceId} subscription canceled`);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err: any) {
    console.error('stripe-webhook handler error:', err.message);
    // Return 500 so Stripe retries
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
