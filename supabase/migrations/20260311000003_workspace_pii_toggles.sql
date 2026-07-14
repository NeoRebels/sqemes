-- ============================================================
-- Content Governance: PII blocking toggles per workspace
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN block_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN block_iban   boolean NOT NULL DEFAULT false,
  ADD COLUMN block_phone  boolean NOT NULL DEFAULT false;
