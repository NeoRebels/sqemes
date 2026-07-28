-- SQEM-151 — grant client UPDATE on workspaces.default_template_access ("Global Access").
--
-- SQEM-109 (20260706160000) replaced blanket UPDATE on public.workspaces with column-level grants,
-- so billing/credit/subscription columns stay service-role-only. SQEM-142 (20260726120000) then
-- added default_template_access — the "Global Access" setting the General tab writes via
-- lib/api/workspaces.ts `updateWorkspace` — but never granted UPDATE on it. Result: saving Global
-- Access failed with "permission denied for table workspaces" (a column-privilege denial, not RLS;
-- the row policy passes). This grants the one missing column, mirroring SQEM-109/113. RLS still
-- governs WHICH rows (admin/editor of the workspace). Drift-tolerant: only if the column exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'default_template_access'
  ) THEN
    EXECUTE 'GRANT UPDATE (default_template_access) ON public.workspaces TO authenticated';
  END IF;
END $$;
