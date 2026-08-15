-- SQEM-212 — "Only me" means the creator, and private templates are handed over when their creator
-- leaves.
--
-- 1. THE PROMISE WAS NOT KEPT. `can_access_template` granted admins and editors access to every
--    template in the workspace, including one carrying the principal-less row that the UI calls
--    "Only me". The label said one thing and the function did another. From here on, a template
--    with that row is readable by `created_by` alone — the admin/editor branch is suspended for it.
--
--    ⚠️ Both functions again: `mcp_accessible_template_ids` mirrors this logic for the mcp-server
--    (auth.uid() is null there). Changing one leaves the app and MCP quietly disagreeing, and each
--    keeps working on its own. The user-less API-key path from SQEM-210 needs nothing: it only ever
--    serves templates with NO rules, and a private one has one.
--
--    A row that is private AND names principals cannot be produced by the UI. If one ever existed,
--    private wins here — the restrictive direction, and the recoverable one.
--
-- 2. THAT CREATES A ROW NOBODY CAN REACH, UNLESS IT IS HANDED OVER. `prompts.created_by` is
--    `on delete set null`, and someone removed from a workspace fails the membership check in
--    `prompts_select` anyway. Either way the creator branch stops matching — and with the admin
--    branch now suspended, the template would be invisible to everyone, forever, with no way to
--    clean it up through the product.
--
--    So a departing member's private templates move to the **longest-standing admin still in the
--    workspace**. There is no owner column on `workspaces` (no `created_by`, no `owner_id`), so
--    `workspace_members.joined_at` is the only available notion of "first admin" — and taking the
--    longest-standing *current* admin answers "what if the first one is gone" by construction,
--    without a special case.
--
--    **No admin left → the template stays put.** Handing a departed colleague's private template to
--    an arbitrary member would break the promise harder than an unreachable row does. A workspace
--    with no admin at all is a broken state in its own right (the account-deletion dialog warns
--    about it today rather than preventing it); making it impossible is its own ticket, and once it
--    lands this branch simply becomes unreachable.

-- 1. Private means the creator, in both functions.
create or replace function public.can_access_template(
  p_template_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = (select auth.uid())
    or (
      not exists (
        select 1 from public.template_access ta
        where ta.template_id = p_template_id and ta.role is null and ta.user_id is null
      )
      and (
        public.get_user_role(p_workspace_id) in ('admin', 'editor')
        or not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
        or exists (
          select 1 from public.template_access ta
          where ta.template_id = p_template_id
            and (ta.role = public.get_user_role(p_workspace_id) or ta.user_id = (select auth.uid()))
        )
      )
    );
$$;

create or replace function public.mcp_accessible_template_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with r as (
    select wm.role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
    limit 1
  )
  select p.id
  from public.prompts p
  where p.workspace_id = p_workspace_id
    and (
      p.created_by = p_user_id
      or (
        not exists (
          select 1 from public.template_access ta
          where ta.template_id = p.id and ta.role is null and ta.user_id is null
        )
        and (
          (select role from r) in ('admin', 'editor')
          or not exists (select 1 from public.template_access ta where ta.template_id = p.id)
          or exists (
            select 1 from public.template_access ta
            where ta.template_id = p.id
              and (ta.role = (select role from r) or ta.user_id = p_user_id)
          )
        )
      )
    );
$$;

-- 2. Hand private templates over when their creator leaves.
create or replace function public.reassign_private_templates(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  select wm.user_id into target
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.role = 'admin'
    and wm.user_id <> p_user_id
  order by wm.joined_at asc
  limit 1;

  -- No admin left to hand them to; leave them where they are (see the header).
  if target is null then
    return;
  end if;

  update public.prompts p
  set created_by = target
  where p.workspace_id = p_workspace_id
    and p.created_by = p_user_id
    and exists (
      select 1 from public.template_access ta
      where ta.template_id = p.id and ta.role is null and ta.user_id is null
    );
end;
$$;

-- 2a. Removed from a workspace (or left it).
create or replace function public.on_workspace_member_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a whole workspace cascades its member rows through here. There is nothing to hand
  -- over then — the prompts are going too — so check the workspace still exists before touching it.
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform public.reassign_private_templates(old.workspace_id, old.user_id);
  end if;
  return old;
end;
$$;

drop trigger if exists workspace_member_removed on public.workspace_members;
create trigger workspace_member_removed
  after delete on public.workspace_members
  for each row execute function public.on_workspace_member_removed();

-- 2b. Account deleted. Deliberately BEFORE the delete: `prompts.created_by` is a foreign key with
-- `on delete set null`, and the order in which two foreign-key actions run is not defined — relying
-- on the membership cascade (2a) to get there first would be a coin flip. Running first makes 2a a
-- no-op for these rows, which is fine: the update is idempotent.
create or replace function public.on_profile_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws record;
begin
  for ws in select workspace_id from public.workspace_members where user_id = old.id loop
    perform public.reassign_private_templates(ws.workspace_id, old.id);
  end loop;
  return old;
end;
$$;

drop trigger if exists profile_deleted_reassign on public.profiles;
create trigger profile_deleted_reassign
  before delete on public.profiles
  for each row execute function public.on_profile_deleted();
