-- ============================================================
-- SQEM-269 — delete a lapsed workspace 90 days after the term ends
-- ============================================================
--
-- Today nothing happens when a subscription ends. `subscription_status` becomes 'canceled' and the
-- data sits there for ever. That is two failures at once: **Article 5(1)(e) GDPR** (storage
-- limitation — keeping personal data with no purpose and no end is not a neutral state), and a
-- contradiction of what the rewritten Terms § 8 promise, namely 30 days of export access and
-- deletion after 90.
--
-- The export half already works (SQEM-267). This is the other half.
--
-- Modelled on `cleanup-abandoned-workspaces` (SQEM-102) — same two phases, same warning discipline,
-- same cron-secret transport. Deliberately **not** merged into that function: its candidates are
-- workspaces that never subscribed, and its query says so (`subscription_status IS NULL`). Widening
-- that predicate to cover paying customers would put "never used it" and "used it for two years"
-- through one code path, and the blast radius of a mistake there is not symmetric.
--
-- ============================================================
-- ⚠️ THE BACKFILL IS THE DANGEROUS PART, AND IT IS WHY THIS MIGRATION IS SHAPED LIKE THIS
-- ============================================================
--
-- Nothing records *when* a subscription ended, so every already-lapsed workspace needs a value.
-- Backfilling it from anything historical — `created_at`, an old invoice, a guess — would hand
-- workspaces a date that is already more than 90 days old, and **the very first cron run would
-- delete real customer data with a warning email nobody had time to read.**
--
-- So the backfill uses `now()`. Every workspace that lapsed before today starts its 90 days from
-- today. That is more generous than the Terms require, it is wrong in the only harmless direction,
-- and it is the whole reason this can ship without holding anyone's breath.

-- 1. When the contract ended. Written by the Stripe webhook from here on; cleared on reactivation.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS subscription_ended_at timestamptz;

-- 2. When the deletion warning was emailed. A column of its own rather than reusing
--    `deletion_warning_sent_at`: the two flows are disjoint *today* only because the abandoned
--    finder requires `subscription_status IS NULL`. Sharing state across that boundary would make a
--    future change to one query silently corrupt the other.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS lapse_warning_sent_at timestamptz;

-- 3. Both cleanup paths write to the same audit table, so it has to say which one acted.
ALTER TABLE public.deleted_workspaces_audit
  ADD COLUMN IF NOT EXISTS reason text;

COMMENT ON COLUMN public.workspaces.subscription_ended_at IS
  'SQEM-269 — when the subscription lapsed (canceled/unpaid). Starts the 90-day retention clock. NULL while active, trialing, past_due, or never subscribed.';

-- 4. The backfill. See the block above: `now()`, not a historical date, and never for a workspace
--    that is currently fine.
UPDATE public.workspaces
   SET subscription_ended_at = now()
 WHERE subscription_ended_at IS NULL
   AND subscription_status IN ('canceled', 'unpaid')
   AND is_managed = false;

-- 5. Candidate finder. Returns every workspace whose clock has passed the warning threshold, with
--    the emails of **all** its admins.
--
--    All admins, not the longest-standing one: `reassign_private_templates()` picks a single admin
--    because ownership must land somewhere definite. A warning is the opposite case — one admin on
--    holiday must not cost the workspace its data, and a second address costs nothing.
CREATE OR REPLACE FUNCTION public.find_lapsed_workspace_candidates(min_days_since_end int)
RETURNS TABLE (
  workspace_id          uuid,
  name                  text,
  subscription_ended_at timestamptz,
  lapse_warning_sent_at timestamptz,
  admin_emails          text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    w.subscription_ended_at,
    w.lapse_warning_sent_at,
    coalesce(
      array_agg(DISTINCT p.email) FILTER (WHERE p.email IS NOT NULL AND wm.role = 'admin'),
      '{}'::text[]
    )
  FROM public.workspaces w
  LEFT JOIN public.workspace_members wm ON wm.workspace_id = w.id
  LEFT JOIN public.profiles p ON p.id = wm.user_id
  WHERE w.subscription_ended_at IS NOT NULL
    AND w.subscription_status IN ('canceled', 'unpaid')  -- re-checked every run: a reactivated
    AND w.is_managed = false                             -- workspace drops out even if the webhook
    AND w.subscription_ended_at < now() - make_interval(days => min_days_since_end)
  GROUP BY w.id, w.name, w.subscription_ended_at, w.lapse_warning_sent_at;
$$;

REVOKE ALL ON FUNCTION public.find_lapsed_workspace_candidates(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_lapsed_workspace_candidates(int) TO service_role;

-- ============================================================================
-- MANUAL, SUPERUSER-ONLY — and deliberately not part of this migration.
--
-- The schema above is inert: without a cron entry nothing ever calls the function, so this
-- migration deletes nothing on the day it lands. Registering the schedule is a separate, conscious
-- act, and it belongs AFTER a dry run has been read.
--
--   -- 1. Dry run first (deletes nothing, reports what it would do):
--   --    POST <project>/functions/v1/cleanup-lapsed-workspaces
--   --    header  x-cron-secret: <CRON_SECRET>
--   --    body    {"dryRun": true}
--   --
--   -- 2. Only once that output looks right:
--   SELECT cron.schedule(
--     'cleanup-lapsed-workspaces',
--     '30 3 * * *',
--     $$ SELECT net.http_post(
--          url := '<project>/functions/v1/cleanup-lapsed-workspaces',
--          headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb
--        ); $$
--   );
--
-- ⚠️ Self-host must never register this. There is no subscription model there, so nothing ever
-- lapses — but the function also refuses to run when SELF_HOSTED is set, so a mistaken schedule is
-- inert rather than destructive.
-- ============================================================================
