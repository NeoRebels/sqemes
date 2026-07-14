-- ============================================================
-- Migration: Prompt Visibility (published/draft)
-- ============================================================

ALTER TABLE prompts ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
