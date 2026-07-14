-- ============================================================
-- SQEM-040 — Unified template model
-- ============================================================
-- Adds kind/content/system_instruction/context_file_ids/skill_ids/model
-- to prompts, backfills from steps[0], migrates workspace assistants,
-- then drops the separate assistants tables.

ALTER TABLE public.prompts
  ADD COLUMN kind               text NOT NULL DEFAULT 'prompt'
                                CHECK (kind IN ('prompt', 'assistant', 'skill')),
  ADD COLUMN content            text NOT NULL DEFAULT '',
  ADD COLUMN system_instruction text,
  ADD COLUMN context_file_ids   uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN skill_ids          uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN model              text;

-- Backfill content and model from steps[0] for existing prompts
UPDATE public.prompts
SET
  content = COALESCE(
    CASE
      WHEN steps IS NOT NULL
        AND jsonb_typeof(steps::jsonb) = 'array'
        AND jsonb_array_length(steps::jsonb) > 0
      THEN steps::jsonb->0->>'content'
    END,
    ''
  ),
  model = CASE
    WHEN steps IS NOT NULL
      AND jsonb_typeof(steps::jsonb) = 'array'
      AND jsonb_array_length(steps::jsonb) > 0
    THEN steps::jsonb->0->>'model'
  END;

-- Migrate workspace assistants into prompts with kind='assistant'
INSERT INTO public.prompts (
  id, workspace_id, kind, title, description,
  content, system_instruction,
  published, automatable, is_favorite,
  outbound_urls, tags, variables,
  context_file_ids, skill_ids,
  usage_count, created_by,
  created_at, updated_at,
  notification_secret
)
SELECT
  id,
  workspace_id,
  'assistant',
  name,
  COALESCE(description, ''),
  '',
  system_prompt,
  false,
  false,
  false,
  '{}',
  '{}',
  '[]'::jsonb,
  '{}',
  '{}',
  0,
  NULL,
  COALESCE(created_at, now()),
  now(),
  gen_random_uuid()::text
FROM public.assistants
WHERE workspace_id IS NOT NULL;

-- Drop in FK-dependency order
-- Remove FK from chat_sessions before dropping assistants
ALTER TABLE IF EXISTS public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_assistant_id_fkey;

DROP TABLE IF EXISTS public.workspace_dismissed_global_assistants;
DROP TABLE IF EXISTS public.global_assistants;
DROP TABLE IF EXISTS public.assistants;
