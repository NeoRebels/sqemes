-- SQEM-130 — Solo AI-credit allowance 5,000 -> 2,000 (Cloud pricing update).
-- Updates the allowance function (used on workspace creation / provisioning) and migrates existing
-- Solo workspaces that still carry the old 5,000 allowance. Managed workspaces (unlimited,
-- credits_limit = 0) and any custom/unlimited limits are left untouched. Idempotent.

-- 1. New allowance mapping (Solo 5000 -> 2000; Team / Business unchanged).
CREATE OR REPLACE FUNCTION public.plan_credit_limit(p public.plan_tier)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE p
    WHEN 'Solo' THEN 2000
    WHEN 'Team' THEN 25000
    WHEN 'Business' THEN 100000
    ELSE 0
  END;
$$;

-- 2. Migrate existing Solo workspaces still on the old 5,000 allowance.
--    Only rows at exactly 5000 and not managed — preserves unlimited (0), managed, and custom values.
UPDATE public.workspaces
  SET credits_limit = 2000
  WHERE plan = 'Solo' AND NOT is_managed AND credits_limit = 5000;
