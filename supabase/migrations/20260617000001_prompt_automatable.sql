-- Backfill missing automatable column on prompts (was added to production without a migration)
ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS automatable boolean NOT NULL DEFAULT false;
