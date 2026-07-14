-- ============================================================
-- Managed Workspaces
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS is_managed boolean NOT NULL DEFAULT false;

-- RPC to toggle managed status — only sqemes admins can call this
CREATE OR REPLACE FUNCTION public.set_workspace_managed(ws_id uuid, managed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_sqemes_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.workspaces
  SET is_managed = managed
  WHERE id = ws_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
