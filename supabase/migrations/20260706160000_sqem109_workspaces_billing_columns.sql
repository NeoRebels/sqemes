-- SQEM-109 — Protect workspaces billing/credit/subscription columns from client writes.
--
-- The `workspaces_update` RLS policy lets admin/editor update the workspaces row, but RLS
-- can't restrict WHICH columns — so an admin/editor could `PATCH /rest/v1/workspaces` to set
-- `plan`, `subscription_status`, `credits_limit`/`credits_used`, `is_managed`, `stripe_*`, etc.
-- and defeat the Stripe paywall + credit meter without paying.
--
-- Fix with column-level privileges: revoke blanket UPDATE from the PostgREST-facing roles and
-- re-grant UPDATE only on the settings columns the app legitimately writes (the client's single
-- update path, store/workspace.tsx → lib/api/workspaces.ts `updateWorkspace`). Billing/credit/
-- subscription columns are never granted → service-role-only (the Stripe webhook + edge functions
-- run as the service role, which bypasses column grants). The RLS policy still governs WHICH rows.
--
-- Drift-tolerant: grant only the settings columns that actually EXIST in this database. The
-- staging project was found missing some columns its migration history claims (e.g. the
-- `block_*` PII toggles from 20260311000003) — a schema-vs-history drift on that project. The
-- security objective (never grant billing columns) holds regardless of which optional settings
-- columns are present, so we skip any missing one instead of failing the migration.

DO $$
DECLARE
  col  text;
  cols text[] := ARRAY[
    'name', 'blacklisted_terms', 'tags',
    'block_emails', 'block_iban', 'block_phone',
    'openrouter_models', 'brand_profile'
  ];
BEGIN
  EXECUTE 'REVOKE UPDATE ON public.workspaces FROM anon, authenticated';

  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = col
    ) THEN
      EXECUTE format('GRANT UPDATE (%I) ON public.workspaces TO authenticated', col);
    END IF;
  END LOOP;
END $$;
