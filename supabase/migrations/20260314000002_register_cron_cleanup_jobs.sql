-- ============================================================
-- Re-apply TTL schema setup.
-- The original TTL migrations (20260311000001, 20260311000002)
-- rolled back entirely when cron.schedule() failed because
-- pg_cron was not yet enabled.
-- NOTE: cron.schedule() calls must be run manually in the
-- Supabase SQL Editor (they require postgres superuser access).
-- ============================================================

-- ── chat_sessions ────────────────────────────────────────────

DROP TRIGGER IF EXISTS enforce_chat_session_cap_trigger ON public.chat_sessions;
DROP FUNCTION IF EXISTS public.enforce_chat_session_cap();

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT now() + interval '7 days';

-- Shared sessions should never expire
UPDATE public.chat_sessions
  SET expires_at = NULL
  WHERE visibility = 'workspace';

-- Trigger to keep expires_at in sync on visibility change
CREATE OR REPLACE FUNCTION public.manage_chat_session_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.visibility = 'workspace' AND NEW.visibility = 'private' THEN
    NEW.expires_at := now() + interval '7 days';
  ELSIF OLD.visibility = 'private' AND NEW.visibility = 'workspace' THEN
    NEW.expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_session_expiry_trigger ON public.chat_sessions;
CREATE TRIGGER chat_session_expiry_trigger
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.manage_chat_session_expiry();

-- ── history_items ─────────────────────────────────────────────

ALTER TABLE public.history_items
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days';

-- Backfill: set expires_at based on created_at for existing records
UPDATE public.history_items
  SET expires_at = created_at + interval '7 days';
