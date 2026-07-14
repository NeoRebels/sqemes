-- SQEM-057 — track whether a subscription is set to cancel at period end (e.g. the
-- user canceled via the billing portal). The subscription stays trialing/active until
-- the period ends, so status alone can't tell us; this flag drives the "canceling" banner.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
