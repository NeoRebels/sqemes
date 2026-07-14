-- ============================================================
-- SQEM-106 Phase 2 — workspace brand profile
-- ============================================================
-- Persist the onboarding brand inputs (previously discarded after the wizard)
-- as a workspace-level profile. Powers marketplace "Adapt to my brand" (Phase 3),
-- re-running starters, and the Settings -> Brand panel.
-- Stored as jsonb on workspaces; RLS on workspaces already scopes read/write to
-- members, and write is gated to editors/admins at the app layer.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brand_profile jsonb;
