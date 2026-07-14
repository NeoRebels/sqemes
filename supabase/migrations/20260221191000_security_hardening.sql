-- Fix: function_search_path_mutable
-- All SECURITY DEFINER functions must have SET search_path to prevent
-- search-path injection attacks where a malicious schema could shadow public tables.

CREATE OR REPLACE FUNCTION public.get_user_role(ws_id uuid)
RETURNS workspace_role
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = ws_id AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT workspace_id FROM public.workspace_members
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.increment_credits(ws_id uuid, amount integer)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspaces
  SET credits_used = credits_used + amount
  WHERE id = ws_id;
$$;

CREATE OR REPLACE FUNCTION public.increment_template_usage(template_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.library_templates
  SET usage_count = usage_count + 1
  WHERE id = template_id;
$$;

CREATE OR REPLACE FUNCTION public.is_sqemes_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_sqemes_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Fix: rls_policy_always_true on workspaces_insert
-- Restrict INSERT to rows with safe defaults — prevents authenticated users
-- from creating workspaces with arbitrary credits_used / credits_limit values.
-- Workspace creation via the create_workspace() RPC (SECURITY DEFINER) is
-- unaffected since SECURITY DEFINER functions bypass RLS.

DROP POLICY IF EXISTS workspaces_insert ON public.workspaces;
CREATE POLICY workspaces_insert ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (credits_used = 0 AND credits_limit = 0);
