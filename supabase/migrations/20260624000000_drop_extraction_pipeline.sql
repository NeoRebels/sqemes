-- ============================================================
-- Drop the text-extraction pipeline (SQEM-049 Inc 3)
-- ============================================================
-- Files are now delivered natively at use time: images/PDF as
-- base64, text/code read raw (Inc 1b), and MCP serves bytes from
-- Storage (Inc 2). Nothing reads or writes extracted_text /
-- extraction_status any more, and the extract-file-text function
-- is removed, so the columns + their realtime feed are dropped.

-- Realtime on workspace_files existed only to push extraction_status
-- updates to the client. Remove it (guarded — the table may not be
-- in the publication in every environment).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_files'
  ) then
    alter publication supabase_realtime drop table public.workspace_files;
  end if;
end $$;

alter table public.workspace_files
  drop constraint if exists workspace_files_extraction_status_check;

alter table public.workspace_files
  drop column if exists extracted_text,
  drop column if exists extraction_status;
