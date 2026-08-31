-- ============================================================
-- SQEM-291 — a context file is only as visible as the templates that use it
-- ============================================================
--
-- Asked by the owner: *"do only the people with access to a restricted template have access to its
-- files?"* The answer was **no**, in every channel. `workspace_files_select` tested workspace
-- membership and nothing else:
--
--   using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()))
--
-- So template access control could be sidestepped without attacking it. A template can be "Only me",
-- enforced carefully through `can_access_template()` — and its context file sat beside it, readable
-- by every member of the workspace. With context files that is the wrong way round: the template is
-- the instruction, **the file is the material**. Price lists, contracts, brand rules, salary tables.
--
-- ============================================================
-- Model A (chosen by the owner, 2026-08-31)
-- ============================================================
--
--   A file is as visible as the most visible template that uses it — and always visible to whoever
--   uploaded it.
--
-- The second half is not a softener, it is what makes the first half usable. **A freshly uploaded
-- file belongs to no template yet.** Without the uploader clause it would be invisible to the person
-- who just uploaded it, and "upload, then attach" — the normal order — would break.
--
-- ⚠️ **Why not the tighter rule (visible only via templates).** It reads stricter and is worse: it
-- would hide a file from its own owner between two clicks, which people would work around by
-- attaching files to a dummy template. A rule that invites a workaround protects nothing.
--
-- ⚠️ **What this does NOT do.** A file attached to one open template and one private one is visible
-- to everybody — the open template is the most visible one, and that is the whole rule. Restricting a
-- file therefore means restricting *every* template that uses it. That is a real limitation and it
-- belongs in the documentation rather than in a surprise.

-- ── Who may see a file ───────────────────────────────────────────────────────
--
-- `security definer` so it can read `prompts` and `template_access` regardless of the caller's own
-- RLS — the same shape `can_access_template()` uses, and for the same reason: the question is about
-- the *rules*, not about what this user can already select.

create or replace function public.can_access_file(
  p_file_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- The uploader, always. Covers the file that has no template yet, and the moment right after an
    -- upload before anything is attached.
    p_created_by = (select auth.uid())
    or exists (
      select 1 from public.prompts p
      where p.workspace_id = p_workspace_id
        and p_file_id = any(p.context_file_ids)
        and public.can_access_template(p.id, p.workspace_id, p.created_by)
    );
$$;

comment on function public.can_access_file(uuid, uuid, uuid) is
  'SQEM-291 — a file is visible to whoever uploaded it, and to anyone who can reach at least one template that uses it. Files were workspace-wide until 2026-08-31, which made template access control sidesteppable: the template was protected, its context file was not.';

-- `context_file_ids` is a uuid[] and this function scans it per file. Without an index that is a
-- sequential scan of `prompts` for every row of the file list — fine at ten templates, not at a
-- thousand.
create index if not exists prompts_context_file_ids_gin
  on public.prompts using gin (context_file_ids);

-- ── The table ────────────────────────────────────────────────────────────────

drop policy if exists "workspace_files_select" on public.workspace_files;
create policy "workspace_files_select"
  on public.workspace_files for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
    and public.can_access_file(id, workspace_id, created_by)
  );

-- ── Storage ──────────────────────────────────────────────────────────────────
--
-- ⚠️ **Both halves or neither.** The bytes live in `storage.objects` and are reachable by path
-- without ever touching `workspace_files` — tightening only the table would leave a download route
-- wide open while the list above looked correct. That is the failure mode where a fix reads as done
-- and is not.
--
-- The path is `<workspace_id>/<file_id>/<name>` (see `lib/api/files.ts`), so the second segment is
-- the file id and the same rule applies. Files whose path predates that layout — if any exist — fall
-- back to the membership check rather than becoming unreachable: locking people out of their own
-- data to close a visibility gap would be the worse trade.

drop policy if exists "workspace_files_storage_select" on storage.objects;
create policy "workspace_files_storage_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspace-files'
    and (storage.foldername(name))[1] in (
      select workspace_id::text from public.workspace_members where user_id = auth.uid()
    )
    and (
      -- No file id in the path: a shape we do not produce. Membership alone, as before.
      (storage.foldername(name))[2] is null
      or not exists (
        select 1 from public.workspace_files wf
        where wf.id::text = (storage.foldername(name))[2]
      )
      or exists (
        select 1 from public.workspace_files wf
        where wf.id::text = (storage.foldername(name))[2]
          and public.can_access_file(wf.id, wf.workspace_id, wf.created_by)
      )
    )
  );

comment on table public.workspace_files is
  'Context files. RLS (SQEM-291): visible to the uploader, and to anyone who can access at least one template referencing the file. The storage policy applies the same rule to the bytes — change one and change the other, or the download path outlives the list.';
