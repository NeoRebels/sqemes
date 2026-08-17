-- ============================================================
-- SQEM-234 — the true usage count of a workspace file
-- ============================================================
--
-- The Files page built its "Used in N" from the templates in the client store, and that store only
-- holds what RLS lets the viewer see. A file attached to someone else's restricted template ("Only
-- me") therefore counted zero and was labelled **Unused** — an invitation to delete exactly the file
-- that must not be deleted. Deleting it left the other person's template with a dangling reference
-- and no context, silently.
--
-- The count cannot be computed client-side by design: RLS is hiding the very rows that need counting.
-- Hence a SECURITY DEFINER function that sees every template in the workspace and returns only a
-- NUMBER. Names stay behind the access rules — the caller pairs this total with the templates it can
-- already see and reports the difference as "N restricted templates".
--
-- Decided with the product owner on 2026-08-17: a bare count is an acceptable disclosure. It does
-- tell you "something you cannot see uses this file", and that is precisely what makes the file
-- protectable. Silent data loss is the worse trade.
--
-- ⚠️ SECURITY DEFINER bypasses RLS, so the membership check below is not decoration — without it any
-- authenticated user could count files in any workspace by passing its id.

create or replace function public.workspace_file_usage(p_workspace_id uuid)
returns table (file_id uuid, total_templates int)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    (
      select count(*)::int
      from public.prompts p
      where p.workspace_id = f.workspace_id
        and p.context_file_ids @> array[f.id]
    ) as total_templates
  from public.workspace_files f
  where f.workspace_id = p_workspace_id
    -- The caller must be a member of this workspace. Mirrors workspace_files_select (SQEM-039).
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = (select auth.uid())
    );
$$;

comment on function public.workspace_file_usage(uuid) is
  'SQEM-234 — per-file count of referencing templates, including ones the caller may not see. '
  'Returns numbers only, never titles: the Files page pairs this with the templates already visible '
  'to it and shows the remainder as "restricted". Membership-checked because SECURITY DEFINER '
  'bypasses RLS.';

grant execute on function public.workspace_file_usage(uuid) to authenticated;

-- ============================================================
-- And the part that actually protects the file
-- ============================================================
--
-- Correcting the label is not the fix. `deleteWorkspaceFile` was a bare DELETE with no check at all,
-- reachable from a single confirm in the UI and from a bulk "delete selected" that never mentioned
-- usage. A client-side guard would only be a suggestion — the same lesson as SQEM-213, where the
-- `workspaces_delete` policy had to be dropped because a permitted raw DELETE makes the safe path
-- optional. So the rule lives here.
--
-- The MCP `delete_file` tool is unaffected: it detaches every referencing template first and deletes
-- afterwards, so by the time this trigger runs nothing references the file.

create or replace function public.workspace_files_block_referenced_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_count int;
begin
  -- ⚠️ Do not block a cascade. When a workspace is deleted its files and templates both cascade, and
  -- the order of two FK actions is undefined (the trap SQEM-212 documented). The parent row is
  -- already gone when the cascade fires, so its absence is the reliable signal that this delete is
  -- part of tearing the whole workspace down — not someone removing a single file.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  select count(*)::int into ref_count
  from public.prompts p
  where p.workspace_id = old.workspace_id
    and p.context_file_ids @> array[old.id];

  if ref_count > 0 then
    raise exception
      'This file is still attached to % template(s). Remove it there first — some of them may not be visible to you.', ref_count
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists workspace_files_block_referenced_delete on public.workspace_files;
create trigger workspace_files_block_referenced_delete
  before delete on public.workspace_files
  for each row execute function public.workspace_files_block_referenced_delete();

comment on function public.workspace_files_block_referenced_delete() is
  'SQEM-234 — refuses to delete a file that a template still references, including templates the '
  'caller cannot see. Skips the check when the workspace itself is being deleted, because files and '
  'templates cascade in an undefined order (SQEM-212).';
