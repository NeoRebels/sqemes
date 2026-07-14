-- SQEM-113 — Heal the staging schema drift.
--
-- Staging's public.workspaces was missing the PII-toggle columns that
-- 20260311000003_workspace_pii_toggles.sql adds, even though staging's migration history records
-- that migration as applied. Production is clean (verified via an information_schema diff), so the
-- drift is staging-only — the migration was almost certainly marked applied without actually
-- running on staging (e.g. a `supabase migration repair` or a snapshot restore that force-synced
-- history). This is idempotent: it restores the columns on staging and is a NO-OP on prod (and any
-- from-scratch build, where the columns already exist).
--
-- The GRANT re-applies SQEM-109's column-level UPDATE protection for these columns: on staging they
-- were skipped by 20260706160000 (didn't exist then); on prod that migration already granted them,
-- so this GRANT is a no-op there.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS block_emails boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_iban   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_phone  boolean NOT NULL DEFAULT false;

GRANT UPDATE (block_emails, block_iban, block_phone) ON public.workspaces TO authenticated;
