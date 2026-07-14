-- SQEM-057 phase 2 — DB foundation: trial/subscription fields + per-tier credit
-- provisioning. Provisioning real `credits_limit` values is also the SQEM-082
-- enforcement gate (debits no-op while limit = 0).

-- 1. Trial / subscription state (wired to Stripe + the trial UI in later phases).
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- 2. The decided monthly AI-credit allowance per tier (1 credit = 1,000 tokens).
--    Managed workspaces stay unlimited (credits_limit = 0), so they're never mapped here.
CREATE OR REPLACE FUNCTION public.plan_credit_limit(p public.plan_tier)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p
    WHEN 'Solo' THEN 5000
    WHEN 'Team' THEN 25000
    WHEN 'Business' THEN 100000
    ELSE 0
  END;
$$;

-- 3. Apply the allowance on workspace creation. Both creation paths
--    (handle_new_user trigger, create_workspace RPC) insert credits_limit = 0 under
--    SECURITY DEFINER; this AFTER-insert trigger fills in the tier allowance for
--    non-managed workspaces, so every path is covered by one rule.
CREATE OR REPLACE FUNCTION public.apply_plan_credit_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT new.is_managed AND coalesce(new.credits_limit, 0) = 0 THEN
    UPDATE public.workspaces
      SET credits_limit = public.plan_credit_limit(new.plan)
      WHERE id = new.id;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_apply_credit_limit ON public.workspaces;
CREATE TRIGGER workspaces_apply_credit_limit
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.apply_plan_credit_limit();

-- 4. Backfill existing non-managed workspaces (those still on the old 0 = unlimited).
UPDATE public.workspaces
  SET credits_limit = public.plan_credit_limit(plan)
  WHERE NOT is_managed AND credits_limit = 0;
