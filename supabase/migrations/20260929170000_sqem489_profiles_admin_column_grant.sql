-- SQEM-489 — Nobody can make themselves a Sqemes admin any more.
--
-- `profiles.is_sqemes_admin` is the only thing `is_sqemes_admin()` reads. The `profiles_update` RLS
-- policy lets every authenticated user update their OWN row — but RLS cannot restrict WHICH columns,
-- and `authenticated` held blanket UPDATE on the table. So one `PATCH /rest/v1/profiles` with
-- `{"is_sqemes_admin": true}` made anyone a Sqemes admin: managed workspaces (paywall + credit meter
-- bypassed), marketplace moderation, publisher tokens. Measured on production 2026-09-29:
-- has_column_privilege('authenticated','public.profiles','is_sqemes_admin','UPDATE') = true.
--
-- Same cause and same fix as SQEM-109 for `workspaces`: revoke blanket UPDATE from the PostgREST
-- roles and re-grant UPDATE only on the columns the client legitimately writes. The client has ONE
-- write path to profiles — store/workspace.tsx `updateUser` (name, email, avatar); a source test
-- (tests/unit/profilesAdminColumnGrant.test.ts) keeps that list and this grant in step.
-- `is_sqemes_admin` is never granted → only the service role (SQL editor, edge functions) can set it.
-- The RLS policy still governs WHICH rows. INSERT is unaffected: there is no insert policy, profiles
-- are created by the signup trigger (SECURITY DEFINER).
--
-- Drift-tolerant like SQEM-109: grant only columns that exist, so a schema-vs-history drift on one
-- project cannot fail the migration. Idempotent — REVOKE/GRANT can run any number of times.

DO $$
DECLARE
  col  text;
  cols text[] := ARRAY['name', 'email', 'avatar'];
BEGIN
  EXECUTE 'REVOKE UPDATE ON public.profiles FROM anon, authenticated';

  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = col
    ) THEN
      EXECUTE format('GRANT UPDATE (%I) ON public.profiles TO authenticated', col);
    END IF;
  END LOOP;

  -- Fail loudly rather than ship a migration that did not close the hole.
  IF has_column_privilege('authenticated', 'public.profiles', 'is_sqemes_admin', 'UPDATE') THEN
    RAISE EXCEPTION 'SQEM-489: authenticated can still UPDATE profiles.is_sqemes_admin';
  END IF;
END $$;
