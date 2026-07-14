-- SQEM-067 increment 2 — drop PromptRunner residue tables.
--
-- DESTRUCTIVE. Two-phase production promotion required: the inc-1 code (which
-- stopped reading/writing these tables) must be LIVE on prod BEFORE this runs,
-- or the still-live old frontend would query dropped relations. See
-- pm/PRODUCTION_PROMOTION.md.
--
-- Idempotent (IF EXISTS). CASCADE clears dependent FKs, RLS policies, indexes,
-- triggers, and `supabase_realtime` publication membership.

-- prompts.folder_id — FK column referencing folders.
ALTER TABLE public.prompts DROP COLUMN IF EXISTS folder_id;

-- result_images references saved_results (FK) — drop it first.
DROP TABLE IF EXISTS public.result_images CASCADE;
DROP TABLE IF EXISTS public.saved_results CASCADE;
DROP TABLE IF EXISTS public.history_items CASCADE;
DROP TABLE IF EXISTS public.folders CASCADE;

-- NOTE — manual prod follow-ups (not done here; require superuser / Storage API
-- access and are tracked in pm/PRODUCTION_PROMOTION.md):
--   • unschedule pg_cron jobs 'cleanup-expired-history-items' and
--     'cleanup-result-images-daily';
--   • empty + delete the public 'result-images' Storage bucket;
--   • delete the orphaned edge functions upload-result-images and
--     cleanup-result-images.
