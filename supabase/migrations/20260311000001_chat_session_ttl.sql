-- ============================================================
-- Chat Session TTL: replace hard 50-session cap with 7-day expiry
-- ============================================================

-- Drop the old per-user session cap trigger and function
DROP TRIGGER IF EXISTS enforce_chat_session_cap_trigger ON public.chat_sessions;
DROP FUNCTION IF EXISTS public.enforce_chat_session_cap();

-- Add expires_at: private sessions expire 7 days from creation,
-- shared sessions (visibility = 'workspace') never expire (NULL)
ALTER TABLE public.chat_sessions
  ADD COLUMN expires_at timestamptz DEFAULT now() + interval '7 days';

-- Shared sessions created before this migration should not expire
UPDATE public.chat_sessions
  SET expires_at = NULL
  WHERE visibility = 'workspace';

-- ============================================================
-- Trigger: keep expires_at in sync when visibility changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.manage_chat_session_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- shared → private: start 7-day countdown from now
  IF OLD.visibility = 'workspace' AND NEW.visibility = 'private' THEN
    NEW.expires_at := now() + interval '7 days';
  -- private → shared: remove expiry
  ELSIF OLD.visibility = 'private' AND NEW.visibility = 'workspace' THEN
    NEW.expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_session_expiry_trigger
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.manage_chat_session_expiry();

-- ============================================================
-- pg_cron: delete expired sessions daily at 3am UTC when pg_cron is available.
-- Local Supabase does not always expose pg_cron, so keep the schema migration runnable.
-- ============================================================
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    EXECUTE format(
      'SELECT cron.schedule(%L, %L, %L)',
      'cleanup-expired-chat-sessions',
      '0 3 * * *',
      'DELETE FROM public.chat_sessions WHERE expires_at < now()'
    );
  ELSE
    RAISE NOTICE 'Skipping cleanup-expired-chat-sessions cron job because pg_cron is unavailable.';
  END IF;
END;
$$;
