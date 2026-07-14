-- ============================================================
-- Chat Session TTL: extend retention from 7 days to 30 days
-- ============================================================

-- Update column default
ALTER TABLE public.chat_sessions
  ALTER COLUMN expires_at SET DEFAULT now() + interval '30 days';

-- Extend existing private sessions that haven't expired yet
UPDATE public.chat_sessions
  SET expires_at = expires_at + interval '23 days'
  WHERE expires_at IS NOT NULL
    AND expires_at > now();

-- Replace trigger function with 30-day intervals
CREATE OR REPLACE FUNCTION public.manage_chat_session_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- shared → private: start 30-day countdown from now
  IF OLD.visibility = 'workspace' AND NEW.visibility = 'private' THEN
    NEW.expires_at := now() + interval '30 days';
  -- private → shared: remove expiry
  ELSIF OLD.visibility = 'private' AND NEW.visibility = 'workspace' THEN
    NEW.expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
