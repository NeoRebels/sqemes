-- SQEM-473 — who may CHANGE a playbook or persona, separately from who may see it.
--
-- Until now an editor who could see a playbook could also change or delete it. A workspace could not
-- keep a skill that everybody uses and only some may change — the case that started this is a master
-- skill every persona loads first. Now a playbook or persona can name its editors (people or groups):
--
--   can_edit_* = can see it (unchanged rule)
--                AND ( admin
--                      OR editor AND ( no editors named | caller named, directly or by group | owner ) )
--
-- With no row in `*_editors` nothing changes: the rule reduces to today's (admin or editor who can see
-- it). Members never edit. An admin overrides an edit restriction but gains no SIGHT they did not have:
-- someone else's "only me" playbook stays invisible to them, exactly as before.
--
-- Decided with SQEM-473: personas follow the same rule; a context file that a restricted
-- playbook lists may only be renamed, replaced or deleted by someone who may edit that playbook; and
-- changing WHO MAY SEE a playbook (`template_access` / `persona_access`) now needs the right to edit
-- it. ⛔ That last one closes a real gap: the access policies checked only the role, so any editor
-- could set a playbook to "only me" — hiding it from everyone — without being able to see it.
--
-- ⛔ No function here looks up the row it is asked about in a way RETURNING could miss (SQEM-525):
-- every policy below runs on an UPDATE/DELETE of an existing row, or on an access/editor row whose
-- parent (the playbook or persona) already exists.

-- 1. The editor lists ------------------------------------------------------------------------------
create table if not exists public.template_editors (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.prompts (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  group_id     uuid references public.workspace_groups (id) on delete cascade,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint template_editors_one_principal check ((user_id is not null)::int + (group_id is not null)::int = 1)
);
create unique index if not exists template_editors_user_uq  on public.template_editors (template_id, user_id)  where user_id  is not null;
create unique index if not exists template_editors_group_uq on public.template_editors (template_id, group_id) where group_id is not null;
create index if not exists template_editors_template_idx on public.template_editors (template_id);

create table if not exists public.persona_editors (
  id           uuid primary key default gen_random_uuid(),
  persona_id   uuid not null references public.personas (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  group_id     uuid references public.workspace_groups (id) on delete cascade,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint persona_editors_one_principal check ((user_id is not null)::int + (group_id is not null)::int = 1)
);
create unique index if not exists persona_editors_user_uq  on public.persona_editors (persona_id, user_id)  where user_id  is not null;
create unique index if not exists persona_editors_group_uq on public.persona_editors (persona_id, group_id) where group_id is not null;
create index if not exists persona_editors_persona_idx on public.persona_editors (persona_id);

alter table public.template_editors enable row level security;
alter table public.persona_editors  enable row level security;
revoke all on public.template_editors, public.persona_editors from anon;
grant select, insert, delete on public.template_editors, public.persona_editors to authenticated;

-- 2. The rules, once each --------------------------------------------------------------------------
-- The core takes the user explicitly, so the app (auth.uid()) and the MCP server (service role,
-- acting for the key's owner) run the SAME rule. ⛔ Service role only: a client could otherwise ask
-- about any user id.
create or replace function public.template_edit_allowed(p_template_id uuid, p_user_id uuid)
 returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.prompts p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = p_user_id
     where p.id = p_template_id
       and p.id in (select id from public.mcp_accessible_template_ids(p.workspace_id, p_user_id))
       and (
         wm.role = 'admin'
         or (wm.role = 'editor' and (
               p.created_by = p_user_id
               or not exists (select 1 from public.template_editors te where te.template_id = p.id)
               or exists (select 1 from public.template_editors te
                           where te.template_id = p.id
                             and (te.user_id = p_user_id
                                  or te.group_id in (select gm.group_id from public.workspace_group_members gm where gm.user_id = p_user_id)))
             ))
       )
  );
$function$;

create or replace function public.persona_edit_allowed(p_persona_id uuid, p_user_id uuid)
 returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.personas pe
      join public.workspace_members wm on wm.workspace_id = pe.workspace_id and wm.user_id = p_user_id
     where pe.id = p_persona_id
       and pe.id in (select id from public.mcp_accessible_persona_ids(pe.workspace_id, p_user_id))
       and (
         wm.role = 'admin'
         or (wm.role = 'editor' and (
               pe.created_by = p_user_id
               or not exists (select 1 from public.persona_editors x where x.persona_id = pe.id)
               or exists (select 1 from public.persona_editors x
                           where x.persona_id = pe.id
                             and (x.user_id = p_user_id
                                  or x.group_id in (select gm.group_id from public.workspace_group_members gm where gm.user_id = p_user_id)))
             ))
       )
  );
$function$;

-- A file is editable by an admin or editor of its workspace, unless a playbook that RESTRICTS editing
-- lists it and the user may not edit that playbook. Files of unrestricted
-- playbooks keep today's rule.
create or replace function public.file_edit_allowed(p_file_id uuid, p_workspace_id uuid, p_user_id uuid)
 returns boolean
 language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.workspace_members wm
                  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role in ('admin', 'editor'))
  and not exists (
    select 1 from public.prompts p
     where p.workspace_id = p_workspace_id
       and p_file_id = any (p.context_file_ids)
       and exists (select 1 from public.template_editors te where te.template_id = p.id)
       and not public.template_edit_allowed(p.id, p_user_id)
  );
$function$;

-- The client-facing forms: the same rule for auth.uid().
create or replace function public.can_edit_template(p_template_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.template_edit_allowed(p_template_id, (select auth.uid())) $function$;

create or replace function public.can_edit_persona(p_persona_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.persona_edit_allowed(p_persona_id, (select auth.uid())) $function$;

-- ⛔ A policy calls its function with the CALLER's execute right, so the file policy cannot use the
-- user-id form (which clients must not call — it would answer for anyone). This form answers only
-- for auth.uid().
create or replace function public.can_edit_file(p_file_id uuid, p_workspace_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.file_edit_allowed(p_file_id, p_workspace_id, (select auth.uid())) $function$;

-- Who may SET the editor list: an admin, or the owner while an editor — and only for something they
-- can see. Not any editor: otherwise the next editor simply removes the restriction.
create or replace function public.can_manage_template_editors(p_template_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.prompts p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = (select auth.uid())
     where p.id = p_template_id
       and p.id in (select id from public.mcp_accessible_template_ids(p.workspace_id, (select auth.uid())))
       and (wm.role = 'admin' or (wm.role = 'editor' and p.created_by = (select auth.uid())))
  );
$function$;

create or replace function public.can_manage_persona_editors(p_persona_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.personas pe
      join public.workspace_members wm on wm.workspace_id = pe.workspace_id and wm.user_id = (select auth.uid())
     where pe.id = p_persona_id
       and pe.id in (select id from public.mcp_accessible_persona_ids(pe.workspace_id, (select auth.uid())))
       and (wm.role = 'admin' or (wm.role = 'editor' and pe.created_by = (select auth.uid())))
  );
$function$;

-- SQEM-503 — definer functions are callable by clients only by decision.
revoke all on function public.template_edit_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persona_edit_allowed(uuid, uuid)  from public, anon, authenticated;
revoke all on function public.file_edit_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_edit_template(uuid)            from public, anon;
revoke all on function public.can_edit_persona(uuid)             from public, anon;
revoke all on function public.can_edit_file(uuid, uuid)          from public, anon;
revoke all on function public.can_manage_template_editors(uuid)  from public, anon;
revoke all on function public.can_manage_persona_editors(uuid)   from public, anon;
grant execute on function public.can_edit_template(uuid), public.can_edit_persona(uuid), public.can_edit_file(uuid, uuid),
  public.can_manage_template_editors(uuid), public.can_manage_persona_editors(uuid) to authenticated;
grant execute on function public.template_edit_allowed(uuid, uuid), public.persona_edit_allowed(uuid, uuid),
  public.file_edit_allowed(uuid, uuid, uuid) to service_role;

-- 3. Policies ------------------------------------------------------------------------------------
-- Editor lists: visible to the workspace (the editor shows who may edit); written by owner/admin.
create policy "template_editors_select" on public.template_editors for select to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));
create policy "template_editors_insert" on public.template_editors for insert to authenticated
  with check (
    exists (select 1 from public.prompts p where p.id = template_id and p.workspace_id = template_editors.workspace_id)
    and public.can_manage_template_editors(template_id)
    and (user_id is null or exists (select 1 from public.workspace_members wm where wm.workspace_id = template_editors.workspace_id and wm.user_id = template_editors.user_id))
    and (group_id is null or exists (select 1 from public.workspace_groups g where g.id = template_editors.group_id and g.workspace_id = template_editors.workspace_id))
  );
create policy "template_editors_delete" on public.template_editors for delete to authenticated
  using (public.can_manage_template_editors(template_id));

create policy "persona_editors_select" on public.persona_editors for select to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));
create policy "persona_editors_insert" on public.persona_editors for insert to authenticated
  with check (
    exists (select 1 from public.personas pe where pe.id = persona_id and pe.workspace_id = persona_editors.workspace_id)
    and public.can_manage_persona_editors(persona_id)
    and (user_id is null or exists (select 1 from public.workspace_members wm where wm.workspace_id = persona_editors.workspace_id and wm.user_id = persona_editors.user_id))
    and (group_id is null or exists (select 1 from public.workspace_groups g where g.id = persona_editors.group_id and g.workspace_id = persona_editors.workspace_id))
  );
create policy "persona_editors_delete" on public.persona_editors for delete to authenticated
  using (public.can_manage_persona_editors(persona_id));

-- Playbooks and personas: change/delete need the edit right.
drop policy if exists "prompts_update" on public.prompts;
create policy "prompts_update" on public.prompts for update to authenticated
  using (public.can_edit_template(id));
drop policy if exists "prompts_delete" on public.prompts;
create policy "prompts_delete" on public.prompts for delete to authenticated
  using (public.can_edit_template(id));
drop policy if exists "personas_update" on public.personas;
create policy "personas_update" on public.personas for update to authenticated
  using (public.can_edit_persona(id));
drop policy if exists "personas_delete" on public.personas;
create policy "personas_delete" on public.personas for delete to authenticated
  using (public.can_edit_persona(id));

-- Who may SEE it: changing that is an edit of the playbook/persona (decision 3).
drop policy if exists template_access_insert on public.template_access;
create policy template_access_insert on public.template_access for insert
  with check (
    exists (select 1 from public.prompts p where p.id = template_id and p.workspace_id = template_access.workspace_id)
    and public.can_edit_template(template_id)
  );
drop policy if exists "template_access_delete" on public.template_access;
create policy "template_access_delete" on public.template_access for delete
  using (public.can_edit_template(template_id));
drop policy if exists persona_access_insert on public.persona_access;
create policy persona_access_insert on public.persona_access for insert to authenticated
  with check (
    exists (select 1 from public.personas p where p.id = persona_id and p.workspace_id = persona_access.workspace_id)
    and public.can_edit_persona(persona_id)
  );
drop policy if exists "persona_access_delete" on public.persona_access;
create policy "persona_access_delete" on public.persona_access for delete to authenticated
  using (public.can_edit_persona(persona_id));

-- A persona's routes are part of the persona.
drop policy if exists persona_templates_write on public.persona_templates;
create policy persona_templates_write on public.persona_templates for all to authenticated
  using (public.can_edit_persona(persona_id))
  with check (
    public.can_edit_persona(persona_id)
    and exists (select 1 from public.personas p
                  join public.prompts t on t.id = persona_templates.template_id and t.workspace_id = p.workspace_id
                 where p.id = persona_templates.persona_id)
  );

-- Context files listed by a restricted playbook (decision 2a). Rename and replace go through UPDATE.
-- ⚠️ DELETE needs no new clause: a file any playbook still lists cannot be deleted at all (the
-- SQEM-234 trigger), and the MCP's delete_file — which detaches first — checks the same rule itself.
drop policy if exists "workspace_files_update" on public.workspace_files;
create policy "workspace_files_update" on public.workspace_files for update to authenticated
  using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and role in ('admin', 'editor'))
    and public.can_edit_file(id, workspace_id)
  );
