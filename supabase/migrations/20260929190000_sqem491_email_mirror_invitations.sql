-- SQEM-491 — The profile email is a mirror of the login email, and invitations stop trusting it.
--
-- 1. `profiles.email` was client-writable (SQEM-489 kept it in the column grant because `updateUser`
--    sent it). Settings saved any address there, unconfirmed, while the login address in
--    `auth.users` stayed as it was. Everything that shows or mails "the user's email" reads the
--    profile copy: member lists, access dialogs, the Stripe checkout prefill, deletion/retention
--    mails, the "already a member" check when inviting. So anyone could appear as — and route
--    system mail to — somebody else's address.
--    Now: the client can no longer write it. The only writer is a trigger on `auth.users`, which
--    changes its `email` only after GoTrue's (secure, double-confirmed) email change — so the
--    profile shows an address the user has proven to own.
--
-- 2. `invitations_update` let the INVITEE update an invitation, identified by comparing the row's
--    email with that same client-writable profile email, and it had no WITH CHECK, so the new
--    values of an update were never checked. The client never needs the invitee to update anything
--    (acceptance runs through `accept_invitation`, SECURITY DEFINER, which compares with the LOGIN
--    email). Now: only a workspace admin may update, the new row must still belong to a workspace
--    they administer, and only the columns "Resend" writes are granted.

-- ---------------------------------------------------------------------------------------------
-- 1a. The client may no longer write profiles.email (name, avatar stay — see SQEM-489).
REVOKE UPDATE (email) ON public.profiles FROM anon, authenticated;

-- 1b. The login email is the source; mirror every confirmed change into the profile.
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = coalesce(NEW.email, '') WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- 1c. One-off: put every drifted profile back on its login address. ⛔ Changes data — measured on
--     production 2026-09-29: ONE row (the owner's own test). `raise warning`, because a notice is
--     recorded nowhere on these projects (log_min_messages = warning).
DO $$
DECLARE
  n integer;
BEGIN
  UPDATE public.profiles p
     SET email = u.email
    FROM auth.users u
   WHERE u.id = p.id
     AND u.email IS NOT NULL
     AND p.email IS DISTINCT FROM u.email;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE WARNING 'SQEM-491: % profile email(s) reset to the login address', n;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 2a. Only a workspace admin updates an invitation, and the updated row must stay in a workspace
--     they administer.
DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (public.get_user_role(workspace_id) = 'admin'::public.workspace_role)
  WITH CHECK (public.get_user_role(workspace_id) = 'admin'::public.workspace_role);

-- 2b. Column grants: the client's only update is "Resend" (lib/api/invitations.ts
--     `resendInvitation`: token, expires_at, created_at). workspace_id, email, role, status,
--     invited_by are never client-updatable. Drift-tolerant like SQEM-109/489.
DO $$
DECLARE
  col  text;
  cols text[] := ARRAY['token', 'expires_at', 'created_at'];
BEGIN
  EXECUTE 'REVOKE UPDATE ON public.invitations FROM anon, authenticated';

  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invitations' AND column_name = col
    ) THEN
      EXECUTE format('GRANT UPDATE (%I) ON public.invitations TO authenticated', col);
    END IF;
  END LOOP;

  -- Fail loudly rather than ship a migration that did not close the holes.
  IF has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_sqemes_admin', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.invitations', 'workspace_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.invitations', 'role', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.invitations', 'email', 'UPDATE') THEN
    RAISE EXCEPTION 'SQEM-491: a protected column is still client-writable';
  END IF;
END $$;
