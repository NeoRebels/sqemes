-- Fix invitations_update RLS policy: replace auth.users query (permission denied)
-- with public.profiles which is accessible to authenticated users.

DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE TO authenticated
  USING (
    (email = (SELECT email FROM public.profiles WHERE id = (SELECT auth.uid())))
    OR (get_user_role(workspace_id) = 'admin'::workspace_role)
  );
