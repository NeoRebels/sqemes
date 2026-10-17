-- SQEM-514 — a skill may carry any file, so the `workspace-files` bucket must accept the one extra
-- content type every non-text, non-image, non-PDF file is stored as: application/octet-stream.
--
-- What is stored is decided by `_shared/skillFile.ts` (`classifySkillFile`): text → text/plain, a
-- proven PNG/JPEG/GIF/WebP/PDF → its own type, everything else → application/octet-stream. Links are
-- issued as downloads (Content-Disposition: attachment). ⚠️ Storage sends NO nosniff (measured
-- 2026-10-17); no HTML or SVG type is ever stored. The 15 MB per-file limit stays.
--
-- ⚠️ The original insert (20260617000000_workspace_files.sql) is `on conflict do nothing`, so it never
-- changed an existing bucket — this has to be an UPDATE. Exported to self-host: `selfhost/init/apply.sh`
-- runs every migration, and the same bucket exists there.

update storage.buckets
   set allowed_mime_types = array[
     'image/png', 'image/jpeg', 'image/webp', 'image/gif',
     'application/pdf',
     'text/plain', 'text/csv', 'text/markdown',
     'application/octet-stream'
   ]
 where id = 'workspace-files';

do $$
begin
  if not exists (
    select 1 from storage.buckets
     where id = 'workspace-files' and 'application/octet-stream' = any(allowed_mime_types)
  ) then
    raise exception 'SQEM-514 self-check: workspace-files does not accept application/octet-stream';
  end if;
end $$;
