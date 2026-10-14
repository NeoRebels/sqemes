-- SQEM-509 — files written by the MCP server had no creator, and a file with no creator and no
-- template is visible to nobody.
--
-- `can_access_file` shows a file to its uploader and to whoever can reach a template that lists it.
-- The client insert path gets `created_by` from `guard_client_owned_columns()` (auth.uid()), but that
-- trigger deliberately skips the service role — and the MCP server writes with the service role. Its
-- three file paths (upload_file, finalize_upload, import_skill_from_url) never set the column, so almost
-- every MCP-uploaded file was stored ownerless. While a template still lists such a file, the template carries it. Once it does
-- not — the template was deleted or the file detached — nobody can see it, in the app or over MCP, and
-- therefore nobody can delete it either.
--
-- This migration (the code fix sets `created_by` on all three paths):
--   1. backfills the creator of an ownerless file from the OLDEST template that lists it — over MCP
--      the uploader and the template's creator are the same person in practice, and that person
--      already sees the file through the template, so nobody gains sight of anything new;
--   2. lets a workspace ADMIN see an ownerless file that no template lists, so it can be found and
--      cleaned up — nothing is deleted automatically. Deleting was always
--      allowed for admins and editors (`workspace_files_delete`); only seeing it was not;
--   3. mirrors rule 2 in `library_access_sets`, whose file rule must match `can_access_file`.

-- 1. Backfill ------------------------------------------------------------------------------------
do $$
declare before_null int; fixed int;
begin
  select count(*) into before_null from public.workspace_files where created_by is null;

  update public.workspace_files f
     set created_by = src.created_by
    from (
      select distinct on (f2.id) f2.id, p.created_by
        from public.workspace_files f2
        join public.prompts p
          on p.workspace_id = f2.workspace_id
         and f2.id = any(p.context_file_ids)
       where f2.created_by is null
         and p.created_by is not null
       order by f2.id, p.created_at asc
    ) src
   where f.id = src.id;
  get diagnostics fixed = row_count;

  -- `raise notice` is recorded nowhere on Supabase (log_min_messages = warning, measured) — warning is.
  raise warning 'SQEM-509: % ownerless files before, % got the creator of their oldest template, % remain ownerless',
    before_null, fixed, before_null - fixed;
end $$;

-- 2. Visibility ----------------------------------------------------------------------------------
create or replace function public.can_access_file(p_file_id uuid, p_workspace_id uuid, p_created_by uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    p_workspace_id in (select public.get_user_workspace_ids())
    and (
    -- The uploader, always. Covers the file that has no template yet.
    p_created_by = (select auth.uid())
    or exists (
      select 1 from public.prompts p
      where p.workspace_id = p_workspace_id
        and p_file_id = any(p.context_file_ids)
        and public.can_access_template(p.id, p.workspace_id, p.created_by)
    )
    -- SQEM-509 — an ownerless file no template lists would otherwise be visible to nobody. Admins see
    -- it, so it can be found and deleted. `coalesce`: get_user_role() is NULL for a non-member.
    or (
      p_created_by is null
      and coalesce(public.get_user_role(p_workspace_id) = 'admin', false)
      and not exists (
        select 1 from public.prompts p
        where p.workspace_id = p_workspace_id and p_file_id = any(p.context_file_ids)
      )
    )
    );
$function$;

-- 3. The same rule for the library reader (MCP + Chat), which runs as the service role and is told
--    whom it reads for. Unchanged apart from the third branch.
create or replace function public.library_access_sets(p_workspace_id uuid, p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (
    select p.id, p.title, p.context_file_ids
    from public.prompts p
    where p.workspace_id = p_workspace_id
      and p.id in (select id from public.mcp_accessible_template_ids(p_workspace_id, p_user_id))
  )
  select jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title)) from t), '[]'::jsonb),
    'personas',  coalesce((select jsonb_agg(id) from public.mcp_accessible_persona_ids(p_workspace_id, p_user_id)), '[]'::jsonb),
    'files',     coalesce((select jsonb_agg(distinct fid) from (
                   select unnest(context_file_ids) as fid from t
                   union
                   select f.id from public.workspace_files f
                   where f.workspace_id = p_workspace_id and f.created_by = p_user_id
                   union
                   -- SQEM-509 — mirrors the admin branch of can_access_file().
                   select f.id from public.workspace_files f
                   where f.workspace_id = p_workspace_id
                     and f.created_by is null
                     and exists (select 1 from public.workspace_members m
                                 where m.workspace_id = p_workspace_id and m.user_id = p_user_id
                                   and m.role = 'admin')
                     and not exists (select 1 from public.prompts p
                                     where p.workspace_id = p_workspace_id and f.id = any(p.context_file_ids))
                 ) s), '[]'::jsonb)
  );
$$;

revoke all on function public.library_access_sets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.library_access_sets(uuid, uuid) to service_role;

-- Self-check: fail rather than ship a migration that did not take effect.
do $$
declare missed int;
begin
  -- No ownerless file may remain that a template with a creator lists.
  select count(*) into missed
    from public.workspace_files f
   where f.created_by is null
     and exists (select 1 from public.prompts p
                 where p.workspace_id = f.workspace_id and f.id = any(p.context_file_ids)
                   and p.created_by is not null);
  if missed > 0 then
    raise exception 'SQEM-509: % ownerless files are still listed by a template that has a creator', missed;
  end if;
  if position('get_user_workspace_ids' in pg_get_functiondef('public.can_access_file(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'SQEM-509: can_access_file lost the SQEM-505 membership check';
  end if;
  if position('p_created_by is null' in pg_get_functiondef('public.can_access_file(uuid, uuid, uuid)'::regprocedure)) = 0
     or position('created_by is null' in pg_get_functiondef('public.library_access_sets(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'SQEM-509: the admin branch is missing from can_access_file or library_access_sets';
  end if;
  if has_function_privilege('authenticated', 'public.library_access_sets(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.library_access_sets(uuid, uuid)', 'execute') then
    raise exception 'SQEM-509: library_access_sets is callable by a client again';
  end if;
end $$;
