-- SQEM-031 — Replace Qwen with OpenRouter (BYOK).
-- Per-workspace custom OpenRouter model ids (the Settings "paste your own model id"
-- repeater), and clean up the dead Qwen provider keys.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS openrouter_models text[] NOT NULL DEFAULT '{}';

-- Qwen never had an execution path; drop any orphaned keys so the provider is gone cleanly.
DELETE FROM public.workspace_api_keys WHERE provider = 'qwen';
