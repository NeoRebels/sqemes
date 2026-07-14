import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

// SQEM-057 — free trial length for all tiers (card required; auto-converts to paid).
const TRIAL_PERIOD_DAYS = 14;

// Price IDs per tier (Solo is paid now). Set as Supabase secrets.
const PRICE_IDS: Record<string, Record<string, string>> = {
  Solo: {
    monthly: Deno.env.get('STRIPE_SOLO_MONTHLY_PRICE_ID') ?? '',
    yearly: Deno.env.get('STRIPE_SOLO_YEARLY_PRICE_ID') ?? '',
  },
  Team: {
    monthly: Deno.env.get('STRIPE_TEAM_MONTHLY_PRICE_ID') ?? '',
    yearly: Deno.env.get('STRIPE_TEAM_YEARLY_PRICE_ID') ?? '',
  },
  Business: {
    monthly: Deno.env.get('STRIPE_BUSINESS_MONTHLY_PRICE_ID') ?? '',
    yearly: Deno.env.get('STRIPE_BUSINESS_YEARLY_PRICE_ID') ?? '',
  },
};

// Recursively encode nested objects into Stripe's form-encoded format
function buildFormBody(params: Record<string, any>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'object') {
          parts.push(buildFormBody(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(buildFormBody(value, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createAdminClient();
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const { workspaceId, plan, billingCycle } = await req.json();

    if (!workspaceId || !plan || !billingCycle) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is admin in this workspace
    const { data: membership } = await adminClient
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (!membership || membership.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only workspace admins can manage subscriptions.' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const priceId = PRICE_IDS[plan]?.[billingCycle];
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Invalid plan or billing cycle.' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Fetch existing Stripe customer ID if any
    const { data: ws } = await adminClient
      .from('workspaces')
      .select('stripe_customer_id')
      .eq('id', workspaceId)
      .single();

    // Fetch user profile for checkout prefill
    const { data: profile } = await adminClient
      .from('profiles')
      .select('email, name')
      .eq('id', user.id)
      .single();

    const appUrl = Deno.env.get('APP_URL') ?? '';
    const successUrl = `${appUrl}/#/?checkout=success`;
    const cancelUrl = `${appUrl}/#/`;

    const sessionParams: Record<string, any> = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Require a card even for the trial, so it auto-converts to paid (no free-tier farming).
      payment_method_collection: 'always',
      // Let customers enter a VAT / tax ID and a promotion (discount) code at checkout.
      // Promotion codes must exist in Stripe (Product catalog → Coupons → Promotion codes).
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      // SQEM-084 — Stripe Tax: calculate/apply VAT (reverse charge for valid B2B VAT IDs).
      // REQUIRES Stripe Tax configured (origin + registration + price/account tax_behavior),
      // or checkout fails. Needs the customer address to determine the rate.
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      metadata: { workspace_id: workspaceId, plan, billing_cycle: billingCycle },
      subscription_data: {
        // SQEM-083 — only first-time subscribers get the trial; a returning customer
        // (already has a Stripe customer = subscribed before) is charged immediately,
        // so cancel→resubscribe can't farm fresh trials.
        ...(ws?.stripe_customer_id ? {} : { trial_period_days: TRIAL_PERIOD_DAYS }),
        metadata: { workspace_id: workspaceId, plan, billing_cycle: billingCycle },
      },
    };

    if (ws?.stripe_customer_id) {
      sessionParams.customer = ws.stripe_customer_id;
      // Needed so Stripe can save the collected tax ID + address back to the existing customer.
      sessionParams.customer_update = { name: 'auto', address: 'auto' };
    } else {
      sessionParams.customer_email = profile?.email ?? user.email ?? '';
    }

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildFormBody(sessionParams),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      throw new Error(session.error?.message ?? 'Stripe checkout session creation failed.');
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('create-checkout-session error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
