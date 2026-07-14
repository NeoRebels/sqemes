-- SQEM-064 — RLS: allow workspace admins + editors to UPDATE their API keys
-- (re-scope / change expiry from the Integrations tab, no key re-issue).
--
-- `sqemes_api_keys` already has RLS enabled with select/insert/delete policies
-- (created out-of-band), but no UPDATE policy — so updates were denied. This adds
-- one mirroring the workspace_files pattern (admin/editor only). Idempotent.

ALTER TABLE public.sqemes_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sqemes_api_keys_update" ON public.sqemes_api_keys;
CREATE POLICY "sqemes_api_keys_update"
  ON public.sqemes_api_keys FOR UPDATE
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  );
