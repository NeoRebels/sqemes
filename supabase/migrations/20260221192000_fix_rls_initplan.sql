-- Fix: auth_rls_initplan performance warnings
-- Wrapping auth.uid() in (SELECT auth.uid()) causes PostgreSQL to evaluate it
-- once per query as an init plan rather than once per row, which is a significant
-- performance win on tables with many rows.

-- profiles
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- workspace_members
DROP POLICY IF EXISTS workspace_members_insert ON public.workspace_members;
CREATE POLICY workspace_members_insert ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) OR (get_user_role(workspace_id) = 'admin'::workspace_role));

DROP POLICY IF EXISTS workspace_members_update ON public.workspace_members;
CREATE POLICY workspace_members_update ON public.workspace_members
  FOR UPDATE TO authenticated
  USING ((get_user_role(workspace_id) = 'admin'::workspace_role) AND (user_id <> (SELECT auth.uid())));

DROP POLICY IF EXISTS workspace_members_delete ON public.workspace_members;
CREATE POLICY workspace_members_delete ON public.workspace_members
  FOR DELETE TO authenticated
  USING ((get_user_role(workspace_id) = 'admin'::workspace_role) OR (user_id = (SELECT auth.uid())));

-- history_items
DROP POLICY IF EXISTS history_insert ON public.history_items;
CREATE POLICY history_insert ON public.history_items
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id IN (SELECT get_user_workspace_ids())) AND (user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS history_update ON public.history_items;
CREATE POLICY history_update ON public.history_items
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- saved_results
DROP POLICY IF EXISTS saved_results_insert ON public.saved_results;
CREATE POLICY saved_results_insert ON public.saved_results
  FOR INSERT TO authenticated
  WITH CHECK ((workspace_id IN (SELECT get_user_workspace_ids())) AND (created_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS saved_results_update ON public.saved_results;
CREATE POLICY saved_results_update ON public.saved_results
  FOR UPDATE TO authenticated
  USING ((created_by = (SELECT auth.uid())) OR (get_user_role(workspace_id) = ANY (ARRAY['admin'::workspace_role, 'editor'::workspace_role])));

DROP POLICY IF EXISTS saved_results_delete ON public.saved_results;
CREATE POLICY saved_results_delete ON public.saved_results
  FOR DELETE TO authenticated
  USING ((created_by = (SELECT auth.uid())) OR (get_user_role(workspace_id) = 'admin'::workspace_role));

-- invitations
DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE TO authenticated
  USING ((email = ((SELECT email FROM auth.users WHERE id = (SELECT auth.uid())))::text)
         OR (get_user_role(workspace_id) = 'admin'::workspace_role));
