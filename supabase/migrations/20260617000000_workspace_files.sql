-- ============================================================
-- Workspace file library (SQEM-039)
-- ============================================================

create table if not exists public.workspace_files (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references public.workspaces(id) on delete cascade,
  name              text        not null,
  mime_type         text        not null,
  size_bytes        integer     not null,
  storage_path      text        not null,
  extracted_text    text,
  extraction_status text        not null default 'pending',
  tags              text[]      not null default '{}',
  created_by        uuid        references public.profiles(id),
  created_at        timestamptz not null default now(),
  constraint workspace_files_extraction_status_check
    check (extraction_status in ('pending', 'done', 'failed'))
);

create index if not exists idx_workspace_files_workspace_id
  on public.workspace_files (workspace_id, created_at desc);

alter table public.workspace_files enable row level security;

create policy "workspace_files_select"
  on public.workspace_files for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy "workspace_files_insert"
  on public.workspace_files for insert
  to authenticated
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

create policy "workspace_files_update"
  on public.workspace_files for update
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

create policy "workspace_files_delete"
  on public.workspace_files for delete
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

-- Storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-files',
  'workspace-files',
  false,
  15728640,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv','text/markdown']
)
on conflict (id) do nothing;

create policy "workspace_files_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace-files' and
    (storage.foldername(name))[1] in (
      select workspace_id::text from public.workspace_members where user_id = auth.uid()
    )
  );

create policy "workspace_files_storage_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspace-files' and
    (storage.foldername(name))[1] in (
      select workspace_id::text from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

create policy "workspace_files_storage_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'workspace-files' and
    (storage.foldername(name))[1] in (
      select workspace_id::text from public.workspace_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );
