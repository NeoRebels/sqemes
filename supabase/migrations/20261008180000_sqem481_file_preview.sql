-- SQEM-481 — store the preview of a text context file, so `get_template(include_files: "list")`
-- reads one query instead of downloading every file.
--
-- Measured on production 2026-10-07: `design_diagrams` (154 files) took 12 s at p50 in list mode for
-- a 174 KB answer — the time went into 154 sequential downloads whose only use was a 500-character
-- preview. The preview is a pure function of bytes that never change after upload (no replace path in
-- the app, `storage_path` not client-writable since SQEM-492, no UPDATE policy on the bucket), so it
-- is computed once and kept.
--
-- ⚠️ Both columns are SERVER-OWNED. The edge functions fill them lazily on the first listing
-- (service role). A client must not be able to plant a preview that disagrees with the file: the
-- column-level UPDATE grant from SQEM-492 (name, tags) already excludes them, and the guard trigger
-- below discards them on a client INSERT, which still carries a table-level grant.
-- ⚠️ NULL means "not computed yet" (or a binary, which never gets one). There is no backfill here:
-- a migration cannot read storage, and the first listing fills a file in the same request.

ALTER TABLE public.workspace_files
  ADD COLUMN IF NOT EXISTS preview text,
  ADD COLUMN IF NOT EXISTS preview_truncated boolean;

COMMENT ON COLUMN public.workspace_files.preview IS
  'SQEM-481 — server-computed preview (markdown outline or first 500 chars) for include_files:"list". NULL = not computed yet or binary. Server-owned.';

-- The SQEM-492 guard, extended by the two columns. Everything else is unchanged.
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
    IF TG_TABLE_NAME = 'workspace_files' THEN
      NEW.preview := NULL;
      NEW.preview_truncated := NULL;
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.workspace_id := OLD.workspace_id;
    IF TG_TABLE_NAME IN ('prompts', 'personas') THEN
      NEW.usage_count := OLD.usage_count;
    END IF;
    IF TG_TABLE_NAME = 'workspace_files' THEN
      NEW.preview := OLD.preview;
      NEW.preview_truncated := OLD.preview_truncated;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Self-check: fail rather than ship a migration that did not take effect.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.workspace_files', 'preview', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.workspace_files', 'preview_truncated', 'UPDATE') THEN
    RAISE EXCEPTION 'SQEM-481: the preview columns are client-writable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                 WHERE c.relname = 'workspace_files' AND t.tgname = 'guard_client_owned_columns') THEN
    RAISE EXCEPTION 'SQEM-481: the guard trigger on workspace_files is missing';
  END IF;
  IF position('NEW.preview := NULL' IN pg_get_functiondef('public.guard_client_owned_columns()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SQEM-481: the guard does not discard a client-supplied preview';
  END IF;
END $$;
