-- SQEM-488 — Switching a workspace to managed also makes it unmetered.
--
-- `set_workspace_managed` only flipped `is_managed`. That lifts the paywall (the subscription gate
-- reads `is_managed`), but metering reads `credits_limit` alone (0 = unlimited, `_shared/credits.ts`),
-- and a new workspace carries its plan allowance from the insert trigger (Solo: 2,000). So a workspace
-- switched to managed was still capped — found when "UX Test" was made managed by hand on 2026-09-29
-- and needed a second UPDATE. One rule, in the database, for every caller (Settings and the plan
-- screen): managed → unlimited; unmanaged → the plan's allowance again.
--
-- ⚠️ Switching back overwrites a bespoke allowance with the plan default. Accepted: leaving managed
-- mode is a Sqemes-admin act, and a negotiated number can be set again afterwards.

CREATE OR REPLACE FUNCTION public.set_workspace_managed(ws_id uuid, managed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_sqemes_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.workspaces
     SET is_managed    = managed,
         credits_limit = CASE WHEN managed THEN 0 ELSE public.plan_credit_limit(plan) END
   WHERE id = ws_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
