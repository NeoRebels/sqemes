-- Global assistants table (no workspace_id)
CREATE TABLE public.global_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  system_prompt text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per-workspace dismissal table
CREATE TABLE public.workspace_dismissed_global_assistants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  global_assistant_id uuid NOT NULL REFERENCES public.global_assistants(id) ON DELETE CASCADE,
  dismissed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, global_assistant_id)
);

-- Indexes
CREATE INDEX idx_global_assistants_created_by ON public.global_assistants(created_by);
CREATE INDEX idx_workspace_dismissed_ws ON public.workspace_dismissed_global_assistants(workspace_id);

-- RLS: global_assistants
ALTER TABLE public.global_assistants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "global_assistants_select" ON public.global_assistants
  FOR SELECT USING (published = true OR public.is_sqemes_admin());

CREATE POLICY "global_assistants_insert" ON public.global_assistants
  FOR INSERT WITH CHECK (public.is_sqemes_admin());

CREATE POLICY "global_assistants_update" ON public.global_assistants
  FOR UPDATE USING (public.is_sqemes_admin());

CREATE POLICY "global_assistants_delete" ON public.global_assistants
  FOR DELETE USING (public.is_sqemes_admin());

-- RLS: workspace_dismissed_global_assistants
ALTER TABLE public.workspace_dismissed_global_assistants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dismissed_select" ON public.workspace_dismissed_global_assistants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = workspace_dismissed_global_assistants.workspace_id
        AND user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "dismissed_insert" ON public.workspace_dismissed_global_assistants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = workspace_dismissed_global_assistants.workspace_id
        AND user_id = (SELECT auth.uid())
        AND role IN ('admin', 'editor')
    )
  );

CREATE POLICY "dismissed_delete" ON public.workspace_dismissed_global_assistants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = workspace_dismissed_global_assistants.workspace_id
        AND user_id = (SELECT auth.uid())
        AND role IN ('admin', 'editor')
    )
  );

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_global_assistant_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_global_assistants_updated_at
  BEFORE UPDATE ON public.global_assistants
  FOR EACH ROW EXECUTE FUNCTION public.set_global_assistant_updated_at();
