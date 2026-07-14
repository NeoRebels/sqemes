-- ============================================================
-- History Items TTL: auto-delete prompt execution history after 7 days
-- Saved results (saved_results table) are unaffected.
-- ============================================================

ALTER TABLE public.history_items
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days';

-- pg_cron: delete expired history items daily at 3am UTC when pg_cron is available.
-- Local Supabase does not always expose pg_cron, so keep the schema migration runnable.
DO $$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    EXECUTE format(
      'SELECT cron.schedule(%L, %L, %L)',
      'cleanup-expired-history-items',
      '0 3 * * *',
      'DELETE FROM public.history_items WHERE expires_at < now()'
    );
  ELSE
    RAISE NOTICE 'Skipping cleanup-expired-history-items cron job because pg_cron is unavailable.';
  END IF;
END;
$$;
