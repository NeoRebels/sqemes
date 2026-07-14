-- SQEM-102 — Auto-delete abandoned, never-subscribed, empty workspaces.
--
-- A workspace is a deletion candidate ONLY if it was created, hit the subscription
-- gate, and abandoned: never subscribed (subscription_status IS NULL — a lapsed sub
-- keeps a non-null status, so "used but not renewed" is always protected), not managed,
-- no AI usage, no content, a single member (just the creator), and old enough.
--
-- Flow (driven by the cleanup-abandoned-workspaces edge function, scheduled via pg_cron):
--   • warn the owner by email at ~23 days (7 days before deletion),
--   • delete at ~30 days if the warning was sent ≥ ~7 days earlier and it still qualifies.
--
-- This migration ships the schema + candidate finder. The cron schedule + pg_net are a
-- manual, superuser-only step (see the block at the bottom + PRODUCTION_PROMOTION.md).

-- 1. Track when the deletion warning was emailed (so we don't re-warn daily).
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS deletion_warning_sent_at timestamptz;

-- 2. Audit trail of deletions (service-role only).
CREATE TABLE IF NOT EXISTS public.deleted_workspaces_audit (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  name          text,
  created_at    timestamptz,
  owner_email   text,
  deleted_at    timestamptz not null default now()
);
ALTER TABLE public.deleted_workspaces_audit ENABLE ROW LEVEL SECURITY;
-- No policies → only the service role (edge function) can read/write it.

-- 3. Candidate finder. Returns abandoned workspaces at least `min_age_days` old, one row
--    each (single-member is enforced, so the member join yields the owner's email).
CREATE OR REPLACE FUNCTION public.find_abandoned_workspace_candidates(min_age_days int)
RETURNS TABLE (
  workspace_id             uuid,
  name                     text,
  created_at               timestamptz,
  deletion_warning_sent_at timestamptz,
  owner_email              text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name, w.created_at, w.deletion_warning_sent_at, p.email
  FROM public.workspaces w
  JOIN public.workspace_members wm ON wm.workspace_id = w.id
  JOIN public.profiles p ON p.id = wm.user_id
  WHERE w.subscription_status IS NULL              -- never subscribed / never past the gate
    AND w.is_managed = false                       -- never touch managed workspaces
    AND coalesce(w.credits_used, 0) = 0            -- no AI usage
    AND w.created_at < now() - make_interval(days => min_age_days)
    AND (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1  -- only the creator
    -- empty: no user content (assistants were merged into prompts — SQEM-040 — so prompts covers them)
    AND NOT EXISTS (SELECT 1 FROM public.prompts         pr WHERE pr.workspace_id = w.id)
    AND NOT EXISTS (SELECT 1 FROM public.chat_sessions   cs WHERE cs.workspace_id = w.id)
    AND NOT EXISTS (SELECT 1 FROM public.workspace_files wf WHERE wf.workspace_id = w.id);
$$;

REVOKE ALL ON FUNCTION public.find_abandoned_workspace_candidates(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_abandoned_workspace_candidates(int) TO service_role;

-- ============================================================================
-- MANUAL, SUPERUSER-ONLY (Supabase SQL editor, per project — prod + staging):
-- pg_cron / pg_net / cron.schedule need superuser and are NOT auto-applied here.
--
--   CREATE EXTENSION IF NOT EXISTS pg_net;
--
--   SELECT cron.schedule(
--     'cleanup-abandoned-workspaces',
--     '0 3 * * *',                       -- daily 03:00 UTC
--     $$ SELECT net.http_post(
--          url     := 'https://<project-ref>.supabase.co/functions/v1/cleanup-abandoned-workspaces',
--          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>')
--        ) $$
--   );
--
-- Also: set the `CRON_SECRET` Supabase secret + deploy the edge function.
-- Dry-run before enabling: SELECT * FROM find_abandoned_workspace_candidates(23);
-- ============================================================================
