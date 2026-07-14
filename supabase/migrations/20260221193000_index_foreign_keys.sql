-- Add missing indexes on foreign key columns.
-- PostgreSQL does not auto-index FK columns. Without indexes, any ON DELETE
-- cascade, FK constraint check, or JOIN on these columns requires a full
-- sequential scan of the child table.

CREATE INDEX IF NOT EXISTS idx_folders_user_id              ON public.folders          (user_id);
CREATE INDEX IF NOT EXISTS idx_history_items_prompt_id      ON public.history_items    (prompt_id);
CREATE INDEX IF NOT EXISTS idx_history_items_user_id        ON public.history_items    (user_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by       ON public.invitations      (invited_by);
CREATE INDEX IF NOT EXISTS idx_library_templates_created_by ON public.library_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_prompts_created_by           ON public.prompts          (created_by);
CREATE INDEX IF NOT EXISTS idx_prompts_folder_id            ON public.prompts          (folder_id);
CREATE INDEX IF NOT EXISTS idx_prompts_source_template_id   ON public.prompts          (source_template_id);
CREATE INDEX IF NOT EXISTS idx_saved_results_created_by     ON public.saved_results    (created_by);
CREATE INDEX IF NOT EXISTS idx_saved_results_folder_id      ON public.saved_results    (folder_id);
CREATE INDEX IF NOT EXISTS idx_saved_results_prompt_id      ON public.saved_results    (prompt_id);
