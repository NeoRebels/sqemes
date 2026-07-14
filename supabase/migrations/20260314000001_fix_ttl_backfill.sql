-- ============================================================
-- Fix TTL backfill: immediately delete records older than 7 days.
-- These were not cleaned up because pg_cron was not enabled when
-- the TTL migrations ran (20260311000001, 20260311000002).
-- ============================================================

-- Delete private chat sessions older than 7 days (cascades to chat_messages)
DELETE FROM public.chat_sessions
  WHERE visibility = 'private'
    AND created_at < now() - interval '7 days';

-- Delete history items older than 7 days
DELETE FROM public.history_items
  WHERE created_at < now() - interval '7 days';
