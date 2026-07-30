-- SQEM-163 — User-contributed Marketplace (Phase 3a). Lets a workspace publish its own templates to the
-- marketplace as a moderated **bundle snapshot** (the Phase-1 .sqemes.zip), instead of admin-only curation.
-- Publish is submit-for-review (forced unpublished + pending); a Sqemes-admin approves. Copy downloads the
-- bundle + applies it (importBundle) so context files + skills travel. Additive; curated rows unchanged.

-- 1. library_templates: provenance + review state + the bundle snapshot + display fields.
alter table public.library_templates
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists status text not null default 'published' check (status in ('pending', 'published', 'rejected')),
  add column if not exists bundle_path text,          -- the .sqemes.zip in the library-files bucket (null = curated text-only)
  add column if not exists content text,              -- display body for UGC rows (curated rows use steps[0].content)
  add column if not exists preview jsonb not null default '{}'; -- {fileNames[], fileCount, skillCount} for the detail page without downloading the bundle

-- Existing curated rows stay visible: status defaults to 'published'.

-- 2. SELECT: published to everyone; admins see all; a publisher sees their own workspace's pending/rejected.
drop policy if exists "library_templates_select" on public.library_templates;
create policy "library_templates_select" on public.library_templates
  for select using (
    published = true
    or public.is_sqemes_admin()
    or (workspace_id is not null and workspace_id in (select public.get_user_workspace_ids()))
  );

-- 3. INSERT: sqemes admins (curated) OR a workspace admin/editor submitting their OWN template for review.
--    The WITH CHECK forces unpublished + pending, so a user can never self-publish — an admin must approve.
drop policy if exists "library_templates_insert" on public.library_templates;
create policy "library_templates_insert" on public.library_templates
  for insert with check (
    public.is_sqemes_admin()
    or (
      workspace_id is not null
      and workspace_id in (select public.get_user_workspace_ids())
      and public.get_user_role(workspace_id) in ('admin', 'editor')
      and published = false
      and status = 'pending'
    )
  );

-- UPDATE/DELETE stay sqemes-admin-only (moderation): the existing 00004 policies are unchanged, so a
-- publisher cannot edit or approve their own submission (they re-publish to update).

-- 4. Reports — any authenticated user can report a listing; only admins read/resolve.
create table if not exists public.library_template_reports (
  id                  uuid primary key default gen_random_uuid(),
  library_template_id uuid not null references public.library_templates(id) on delete cascade,
  reporter_id         uuid references public.profiles(id) on delete set null,
  reason              text not null,
  details             text,
  status              text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at          timestamptz not null default now()
);
alter table public.library_template_reports enable row level security;
create policy "library_template_reports_insert" on public.library_template_reports
  for insert to authenticated with check (auth.uid() is not null);
create policy "library_template_reports_admin_select" on public.library_template_reports
  for select using (public.is_sqemes_admin());
create policy "library_template_reports_admin_update" on public.library_template_reports
  for update using (public.is_sqemes_admin());

-- 5. Storage bucket for the published bundle snapshots (private; served to copiers via the
--    get-marketplace-bundle edge function using the service role).
insert into storage.buckets (id, name, public, file_size_limit)
values ('library-files', 'library-files', false, 209715200) -- 200 MB (a bundle can carry context files)
on conflict (id) do nothing;

-- A workspace admin/editor may upload a bundle to their own workspace-prefixed path at publish time.
-- Path layout: {workspaceId}/{uuid}/bundle.sqemes.zip — segment 1 is the workspace id (like workspace-files).
create policy "library_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'library-files'
    and ((storage.foldername(name))[1])::uuid in (select public.get_user_workspace_ids())
    and public.get_user_role(((storage.foldername(name))[1])::uuid) in ('admin', 'editor')
  );
