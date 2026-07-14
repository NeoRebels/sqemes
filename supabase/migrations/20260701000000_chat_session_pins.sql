-- SQEM-038/085 — unified chat history: pinnable internal chats, exempt from the cap.
-- Mirrors external_chat_history.pinned so the shared "Recent chats" widget (webapp
-- Dashboard + extension) treats both sources the same. The webapp DB is the source of truth.

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Retention: cap **non-pinned** sessions at 100 per user/workspace (was 50, all sessions).
-- Pinned sessions are kept indefinitely and don't count toward the cap.
CREATE OR REPLACE FUNCTION public.enforce_chat_session_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  excess int;
BEGIN
  SELECT count(*) - 100 INTO excess
  FROM public.chat_sessions
  WHERE user_id = NEW.user_id
    AND workspace_id = NEW.workspace_id
    AND NOT pinned;

  IF excess >= 0 THEN
    -- Delete the oldest **non-pinned** session(s) by last_active_at to make room.
    DELETE FROM public.chat_sessions
    WHERE id IN (
      SELECT id FROM public.chat_sessions
      WHERE user_id = NEW.user_id
        AND workspace_id = NEW.workspace_id
        AND NOT pinned
      ORDER BY last_active_at ASC
      LIMIT excess + 1
    );
  END IF;

  RETURN NEW;
END;
$$;
