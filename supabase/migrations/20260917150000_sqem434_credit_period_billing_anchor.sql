-- SQEM-434 - the AI-credit month follows Stripe's billing cycle instead of drifting.
--
-- What it did before:
--
--   UPDATE workspaces SET credits_used = 0, credits_period_start = now()
--   WHERE id = ws_id AND credits_period_start <= now() - interval '1 month';
--
-- Three properties, none of them intended. It is LAZY (the reset happens on the next AI call, not at
-- a time), it DRIFTS (the new period starts at now(), so a workspace idle for six weeks pushes its
-- own reset day permanently later), and it is anchored to the workspace's creation date rather than
-- to anything the customer is billed on.
--
-- ==========================================================================================
-- The one decision worth reading before editing: the anchor is `billing_cycle_anchor`, NOT
-- `current_period_start`.
--
-- Credits reset MONTHLY. A subscription can be YEARLY. `current_period_start` moves with the
-- invoice, so on a yearly plan it advances once a year - and that customer would get their credits
-- back once a year. `billing_cycle_anchor` is a fixed reference point that survives renewals, and
-- its day-of-month is the reset day for monthly and yearly plans alike.
--
-- (`invoice.paid` as the trigger fails for the same reason: on a yearly plan it fires once a year.)
-- ==========================================================================================
alter table public.workspaces add column if not exists billing_cycle_anchor timestamptz;

comment on column public.workspaces.billing_cycle_anchor is 'SQEM-434 - Stripe subscription.billing_cycle_anchor, written by stripe-webhook. The day-of-month is the AI-credit reset day. NOT current_period_start: credits are monthly and a subscription can be yearly. Null means the workspace has not had a subscription event since this shipped; ensure_credit_period falls back to the old behaviour until one arrives.';

-- The most recent monthly anniversary of `anchor` at or before `at`, or null when there is nothing
-- to anchor to.
--
-- Month-ends take care of themselves: Postgres clamps `2026-01-31 + 1 month` to 2026-02-28, which is
-- what Stripe does with a 31st anchor in a short month.
--
-- An anchor in the FUTURE returns null rather than a date before the anchor. It should not happen,
-- but a negative age() would otherwise produce a boundary in the past and reset the allowance on
-- every single call.
create or replace function public.credit_period_anchor(anchor timestamptz, at timestamptz)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select case
    when anchor is null or anchor > at then null
    else anchor + make_interval(months =>
      (extract(year from age(at, anchor))::int * 12 + extract(month from age(at, anchor))::int))
  end;
$$;

-- Reset the monthly allowance when the workspace has crossed its reset day.
--
-- ⛔ Still ONE statement. A read-then-write version would be racy: two concurrent calls could both
-- decide a reset is due, and the second would wipe a debit made between them. The condition and the
-- write stay in the same UPDATE, exactly as before.
--
-- ⚠️ `coalesce(..., now())` / `coalesce(..., now() - interval '1 month')` is the FALLBACK for a
-- workspace with no anchor yet: it behaves exactly as it did before, drifting and all, until the
-- next `customer.subscription.updated` stores one. Stripe sends that on every renewal, so the
-- changeover needs no script and no Stripe key outside the webhook.
--
-- ⚠️ TWO small, deliberate consequences of the changeover, named so nobody reads them as a bug:
--
--   1. The first call after an anchor lands can grant ONE extra reset. A workspace whose
--      `credits_period_start` sits before its anchor day has already crossed the new boundary, so the
--      allowance refills mid-month, once. It is bounded (once per workspace, ever) and it falls in the
--      customer's favour, which is the right direction for a changeover nobody asked for.
--   2. The fallback comparison is `<` where it used to be `<=`. That differs only at the exact
--      microsecond the old threshold was hit, and one operator for both branches is worth more than
--      preserving an instant nothing depends on.
create or replace function public.ensure_credit_period(ws_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.workspaces w
  set credits_used = 0,
      credits_period_start = coalesce(public.credit_period_anchor(w.billing_cycle_anchor, now()), now())
  where w.id = ws_id
    and w.credits_period_start < coalesce(
      public.credit_period_anchor(w.billing_cycle_anchor, now()),
      now() - interval '1 month'
    );
$$;
