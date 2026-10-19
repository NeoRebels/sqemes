-- SQEM-512 — the file list checks access once per query instead of once per file.
--
-- `workspace_files_select` called `can_access_file(id, workspace_id, created_by)` for every row, and for a
-- member that function scans the workspace's templates per file. It runs on every app start
-- (`fetchWorkspaceFiles`), and its cost grows with files × templates, so it is the query that dominates
-- the database as a library grows.
--
-- The rule is unchanged; only its shape is. A row is visible to a member of its workspace when
--   (a) they uploaded it                         — checked ON THE ROW, see below
--   (b) a template they can access lists it      — in accessible_file_ids(), computed once per query
--   (c) it has no creator, no template lists it,
--       and they are an admin (SQEM-509)         — in accessible_file_ids()
-- exactly the three clauses of `can_access_file`, which stays as it is: the storage policy still uses it
-- for one object at a time.
--
-- ⛔ (a) MUST stay a per-row check and must not move into the function. The app uploads with
-- `insert(...).select()`, and Postgres checks this SELECT policy on the row RETURNING hands back — a row
-- a STABLE function cannot see from inside the same statement. Looked up in the set, the uploader's own
-- new file would be missing and every browser upload would end in 42501. That is exactly what broke
-- persona creation (SQEM-525); tests/isolation/fileListSetBased.test.ts proves it both ways.
--
-- ⛔ (b) joins the listed id back to a file IN THE TEMPLATE'S OWN WORKSPACE, as `can_access_file` does
-- (`p.workspace_id = p_workspace_id`). Without the join, a template of workspace 1 listing a file id of
-- workspace 2 would show that file to anyone in both.

create or replace function public.accessible_file_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select f.id
    from (select p.workspace_id, unnest(p.context_file_ids) as fid
            from public.prompts p
           where p.workspace_id in (select public.get_user_workspace_ids())
             and public.can_access_template(p.id, p.workspace_id, p.created_by)) listed
    join public.workspace_files f on f.id = listed.fid and f.workspace_id = listed.workspace_id
  union
  select f.id
    from public.workspace_files f
   where f.created_by is null
     and f.workspace_id in (select public.get_user_workspace_ids())
     and coalesce(public.get_user_role(f.workspace_id) = 'admin', false)
     and not exists (select 1 from public.prompts p
                      where p.workspace_id = f.workspace_id and f.id = any(p.context_file_ids))
$function$;

comment on function public.accessible_file_ids() is
  'SQEM-512 — ids of the files auth.uid() sees through a template or as admin of an ownerless file; '
  'clauses (b) and (c) of can_access_file as a set. The uploader clause stays per row in workspace_files_select.';

-- SQEM-503 — a definer function is callable by clients only by decision. This one is: the policy runs it
-- as the caller. It answers only for auth.uid() and only within their own workspaces.
revoke all on function public.accessible_file_ids() from public, anon;
grant execute on function public.accessible_file_ids() to authenticated;

drop policy if exists "workspace_files_select" on public.workspace_files;
create policy "workspace_files_select"
  on public.workspace_files for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
    and (
      created_by = (select auth.uid())
      or id in (select public.accessible_file_ids())
    )
  );

-- Self-test: for every member and every file of their workspaces, the new rule and can_access_file give
-- the same answer. Counts only, no content is read. Aborts the migration on any difference.
do $$
declare
  u record;
  differ bigint;
  checked bigint := 0;
  users int := 0;
begin
  for u in select distinct user_id from public.workspace_members loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    select count(*) filter (where old_rule is distinct from new_rule), count(*)
      into differ, checked
      from (
        -- coalesce: both rules yield NULL rather than false for an ownerless file (NULL = uid), and the
        -- policy treats NULL as "not visible" — so that is the same answer, not a difference.
        select coalesce(public.can_access_file(f.id, f.workspace_id, f.created_by), false) as old_rule,
               coalesce(f.created_by = u.user_id or f.id in (select public.accessible_file_ids()), false) as new_rule
          from public.workspace_files f
         where f.workspace_id in (select workspace_id from public.workspace_members where user_id = u.user_id)
      ) x;
    if differ > 0 then
      raise exception 'SQEM-512 self-test: % of % files differ between can_access_file and the new rule for one member', differ, checked;
    end if;
    users := users + 1;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  -- `raise notice` is recorded nowhere on Supabase (log_min_messages = warning) — warning is.
  raise warning 'SQEM-512 self-test passed for % members', users;
end $$;
