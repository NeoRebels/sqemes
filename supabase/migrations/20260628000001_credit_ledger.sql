-- SQEM-082 phase 1 — AI-credits ledger foundation.
-- credits_used / credits_limit already exist (credits_limit = 0 means unlimited),
-- and increment_credits(ws_id, amount) is the atomic debit primitive. This adds
-- the monthly-reset bookkeeping the metering layer needs.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS credits_period_start timestamptz NOT NULL DEFAULT now();

-- Reset the monthly allowance when a full period has elapsed. Atomic + idempotent:
-- only resets when due, restarting the period from now.
CREATE OR REPLACE FUNCTION public.ensure_credit_period(ws_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspaces
  SET credits_used = 0,
      credits_period_start = now()
  WHERE id = ws_id
    AND credits_period_start <= now() - interval '1 month';
$$;
