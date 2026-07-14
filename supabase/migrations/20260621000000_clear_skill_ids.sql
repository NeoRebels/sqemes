-- SQEM-047 — Skills can no longer be attached to prompts or assistants.
-- Clear all existing skill_id assignments across all template kinds.
UPDATE public.prompts SET skill_ids = '{}';
