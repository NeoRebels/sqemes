-- SQEM-492 — Client write rules, tightened table by table after the rights audit (2026-09-29).
-- Same principle as SQEM-489/491: RLS decides rows, not columns or values, so each client-writable
-- table gets explicit column grants, value checks, or a guard trigger. Production data was checked
-- first: no existing row violates any rule below. The rationale per item lives in the ticket.

-- 1. workspace_files ----------------------------------------------------------------------------
ALTER TABLE public.workspace_files
  DROP CONSTRAINT IF EXISTS workspace_files_path_in_workspace;
ALTER TABLE public.workspace_files
  ADD CONSTRAINT workspace_files_path_in_workspace
  CHECK (storage_path LIKE workspace_id::text || '/%');

REVOKE UPDATE ON public.workspace_files FROM anon, authenticated;
GRANT UPDATE (name, tags) ON public.workspace_files TO authenticated;

-- 2. storage: qualify the object name in the per-file check (it resolved to workspace_files.name) --
DROP POLICY IF EXISTS "workspace_files_storage_select" ON storage.objects;
CREATE POLICY "workspace_files_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'workspace-files'
    AND (storage.foldername(objects.name))[1] IN (
      SELECT workspace_id::text FROM public.workspace_members WHERE user_id = auth.uid()
    )
    AND (
      (storage.foldername(objects.name))[2] IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.workspace_files wf
        WHERE wf.id::text = (storage.foldername(objects.name))[2]
      )
      OR EXISTS (
        SELECT 1 FROM public.workspace_files wf
        WHERE wf.id::text = (storage.foldername(objects.name))[2]
          AND public.can_access_file(wf.id, wf.workspace_id, wf.created_by)
      )
    )
  );

-- 3. library_templates: submissions stay inside the submitting workspace's folder; server-owned
--    counters are not client-insertable.
DROP POLICY IF EXISTS library_templates_insert ON public.library_templates;
CREATE POLICY library_templates_insert ON public.library_templates
  FOR INSERT
  WITH CHECK (
    public.is_sqemes_admin()
    OR (
      workspace_id IS NOT NULL
      AND workspace_id IN (SELECT public.get_user_workspace_ids())
      AND public.get_user_role(workspace_id) = ANY (ARRAY['admin'::public.workspace_role, 'editor'::public.workspace_role])
      AND published = false
      AND status = 'pending'
      AND (bundle_path IS NULL OR bundle_path LIKE workspace_id::text || '/%')
    )
  );

DO $$
DECLARE
  col  text;
  cols text[] := ARRAY[
    'kind', 'title', 'description', 'category', 'tags', 'variables', 'steps', 'created_by',
    'published', 'updated_at', 'workspace_id', 'content', 'status', 'bundle_path', 'preview',
    'source_prompt_id', 'content_hash', 'scan_risk', 'scan_reasons', 'system_instruction', 'brand_config'
  ];
BEGIN
  EXECUTE 'REVOKE INSERT ON public.library_templates FROM anon, authenticated';
  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'library_templates' AND column_name = col) THEN
      EXECUTE format('GRANT INSERT (%I) ON public.library_templates TO authenticated', col);
    END IF;
  END LOOP;
END $$;

-- 4. access rows and persona routes must stay inside their own workspace ------------------------
DROP POLICY IF EXISTS template_access_insert ON public.template_access;
CREATE POLICY template_access_insert ON public.template_access
  FOR INSERT
  WITH CHECK (
    public.get_user_role(workspace_id) = ANY (ARRAY['admin'::public.workspace_role, 'editor'::public.workspace_role])
    AND EXISTS (SELECT 1 FROM public.prompts p WHERE p.id = template_id AND p.workspace_id = template_access.workspace_id)
  );

DROP POLICY IF EXISTS persona_access_insert ON public.persona_access;
CREATE POLICY persona_access_insert ON public.persona_access
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role(workspace_id) = ANY (ARRAY['admin'::public.workspace_role, 'editor'::public.workspace_role])
    AND EXISTS (SELECT 1 FROM public.personas p WHERE p.id = persona_id AND p.workspace_id = persona_access.workspace_id)
  );

DROP POLICY IF EXISTS persona_templates_write ON public.persona_templates;
CREATE POLICY persona_templates_write ON public.persona_templates
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.personas p
            WHERE p.id = persona_templates.persona_id
              AND public.get_user_role(p.workspace_id) = ANY (ARRAY['admin'::public.workspace_role, 'editor'::public.workspace_role]))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.personas p
            JOIN public.prompts t ON t.id = persona_templates.template_id AND t.workspace_id = p.workspace_id
            WHERE p.id = persona_templates.persona_id
              AND public.get_user_role(p.workspace_id) = ANY (ARRAY['admin'::public.workspace_role, 'editor'::public.workspace_role]))
  );

-- 5. invitations: only admins invite (matches the UI and the help centre) -----------------------
DROP POLICY IF EXISTS invitations_insert ON public.invitations;
CREATE POLICY invitations_insert ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role(workspace_id) = 'admin'::public.workspace_role
    AND invited_by = auth.uid()
  );

-- 6. chat_sessions: only the columns the app and the extension write ----------------------------
DO $$
DECLARE
  col  text;
  cols text[] := ARRAY['last_active_at', 'title', 'visibility', 'model', 'is_generating', 'pinned',
                       'applied_skill_ids', 'persona_id'];
BEGIN
  EXECUTE 'REVOKE UPDATE ON public.chat_sessions FROM anon, authenticated';
  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'chat_sessions' AND column_name = col) THEN
      EXECUTE format('GRANT UPDATE (%I) ON public.chat_sessions TO authenticated', col);
    END IF;
  END LOOP;
END $$;

-- 7. library_template_reports: a report is filed as yourself, and opens as 'open' ---------------
DROP POLICY IF EXISTS library_template_reports_insert ON public.library_template_reports;
CREATE POLICY library_template_reports_insert ON public.library_template_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'open');

-- 8. Ownership columns are server-owned. The client update path resends whole objects, so a guard
--    trigger keeps them instead of a grant that would fail the save. Only client roles are guarded;
--    edge functions (service role) and SECURITY DEFINER functions are untouched.
CREATE OR REPLACE FUNCTION public.guard_client_owned_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.workspace_id := OLD.workspace_id;
    IF TG_TABLE_NAME IN ('prompts', 'personas') THEN
      NEW.usage_count := OLD.usage_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_client_owned_columns ON public.prompts;
CREATE TRIGGER guard_client_owned_columns BEFORE INSERT OR UPDATE ON public.prompts
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_owned_columns();

DROP TRIGGER IF EXISTS guard_client_owned_columns ON public.personas;
CREATE TRIGGER guard_client_owned_columns BEFORE INSERT OR UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_owned_columns();

DROP TRIGGER IF EXISTS guard_client_owned_columns ON public.workspace_files;
CREATE TRIGGER guard_client_owned_columns BEFORE INSERT OR UPDATE ON public.workspace_files
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_owned_columns();

-- Self-check: fail rather than ship a migration that did not take effect.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.workspace_files', 'storage_path', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.chat_sessions', 'user_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.chat_sessions', 'workspace_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.library_templates', 'score', 'INSERT')
     OR has_column_privilege('authenticated', 'public.library_templates', 'usage_count', 'INSERT') THEN
    RAISE EXCEPTION 'SQEM-492: a protected column is still client-writable';
  END IF;
END $$;
