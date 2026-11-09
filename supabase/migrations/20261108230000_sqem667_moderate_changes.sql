-- SQEM-667 — Moderation, part 2: changes to playbooks and personas the team already uses wait for review.
--
-- With `workspaces.moderation_changes` on, a non-moderator's change to something SHARED (released and not
-- "only me") is stored as a pending change and written only when a moderator or admin releases it; until
-- then the team keeps the released version. A change of ACCESS to anything released is a change too,
-- and so is replacing or deleting a context file a shared playbook uses:
-- such files are locked for non-moderators, and a new file goes in through a change.
--
-- ⭐ The switch only works together with `moderation_new` (SQEM-666): otherwise a new, immediately
-- shared playbook would be the way round reviewing a change. The guard keeps the pair consistent.
--
-- Built on the CURRENT definitions; nothing here replaces an access function (see SQEM-666's lesson).

-- 1. The switch --------------------------------------------------------------------------------------
alter table public.workspaces add column if not exists moderation_changes boolean not null default false;
comment on column public.workspaces.moderation_changes is
  'SQEM-667 — changes of non-moderators to shared playbooks and personas wait for review. Admins only, and only together with moderation_new (guard_moderation_new).';
grant update (moderation_changes) on public.workspaces to authenticated;

create or replace function public.guard_moderation_new()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.moderation_new := false;
      new.moderation_changes := false;
    else
      if new.moderation_new is distinct from old.moderation_new
         and public.get_user_role(old.id) is distinct from 'admin' then
        new.moderation_new := old.moderation_new;
      end if;
      if new.moderation_changes is distinct from old.moderation_changes
         and public.get_user_role(old.id) is distinct from 'admin' then
        new.moderation_changes := old.moderation_changes;
      end if;
    end if;
  end if;
  -- SQEM-667 — reviewing changes only together with reviewing new ones, for every writer.
  if not new.moderation_new then
    new.moderation_changes := false;
  end if;
  return new;
end;
$$;

-- 2. Shared, and gated --------------------------------------------------------------------------------
-- Shared = released (no review state) and not "only me" (no principal-less access row).
create or replace function public.is_shared_object(p_kind text, p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'template' then exists (
      select 1 from public.prompts p where p.id = p_id and p.review_state is null
        and not exists (select 1 from public.template_access ta
                        where ta.template_id = p.id and ta.role is null and ta.user_id is null and ta.group_id is null))
    when 'persona' then exists (
      select 1 from public.personas p where p.id = p_id and p.review_state is null
        and not exists (select 1 from public.persona_access pa
                        where pa.persona_id = p.id and pa.user_id is null and pa.group_id is null))
    else false end;
$$;
revoke all on function public.is_shared_object(text, uuid) from public, anon, authenticated;
grant execute on function public.is_shared_object(text, uuid) to service_role;

-- Whether a change by this person to this workspace's objects needs review at all.
create or replace function public.changes_need_review(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspaces w where w.id = p_workspace_id and w.moderation_changes)
     and not public.is_workspace_moderator(p_workspace_id, p_user_id);
$$;
revoke all on function public.changes_need_review(uuid, uuid) from public, anon, authenticated;
grant execute on function public.changes_need_review(uuid, uuid) to service_role;

-- 3. Pending changes ---------------------------------------------------------------------------------
create table if not exists public.pending_changes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces on delete cascade,
  kind            text not null check (kind in ('template', 'persona')),
  object_id       uuid not null,
  author          uuid not null references public.profiles on delete cascade,
  payload         jsonb not null,
  base_updated_at timestamptz,
  state           text not null default 'pending' check (state in ('pending', 'rejected')),
  note            text,
  decided_by      uuid references public.profiles on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (kind, object_id, author)
);
comment on table public.pending_changes is
  'SQEM-667 — a proposed change to a shared playbook or persona, written by submit_change, applied by decide_change. payload holds only the changed parts: fields, and access / routes when they change.';
create index if not exists pending_changes_open on public.pending_changes (workspace_id) where state = 'pending';

alter table public.pending_changes enable row level security;

-- The person whose question it is: am I a moderator here? (A client may only ask about itself.)
create or replace function public.am_i_moderator(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_workspace_moderator(p_workspace_id, (select auth.uid()));
$$;
revoke all on function public.am_i_moderator(uuid) from public, anon;
grant execute on function public.am_i_moderator(uuid) to authenticated;

-- The author sees their own; moderators and admins of the workspace see every one. Writes go through the
-- functions below only; the author may withdraw (delete) their own.
create policy "pending_changes_select" on public.pending_changes for select to authenticated
  using (author = (select auth.uid()) or public.am_i_moderator(workspace_id));
create policy "pending_changes_delete" on public.pending_changes for delete to authenticated
  using (author = (select auth.uid()));
grant select, delete on public.pending_changes to authenticated;

-- A pending change goes with its object.
create or replace function public.drop_pending_changes_of_object()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pending_changes
   where object_id = old.id and kind = case tg_table_name when 'prompts' then 'template' else 'persona' end;
  return null;
end;
$$;
revoke all on function public.drop_pending_changes_of_object() from public, anon, authenticated;
drop trigger if exists drop_pending_changes_of_object on public.prompts;
create trigger drop_pending_changes_of_object after delete on public.prompts
  for each row execute function public.drop_pending_changes_of_object();
drop trigger if exists drop_pending_changes_of_object on public.personas;
create trigger drop_pending_changes_of_object after delete on public.personas
  for each row execute function public.drop_pending_changes_of_object();

-- 4. Submitting ---------------------------------------------------------------------------------------
-- The core takes the user (the MCP server and Chat run as the service role); the client form asks for
-- auth.uid(). The author must be allowed to edit the object today — a pending change is an edit.
create or replace function public.submit_change_for_user(p_kind text, p_id uuid, p_payload jsonb, p_base timestamptz, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid; v_id uuid;
begin
  if p_kind = 'template' then
    select workspace_id into v_ws from public.prompts where id = p_id;
    if v_ws is null or not public.template_edit_allowed(p_id, p_user) then
      raise exception 'You may not change this playbook.' using errcode = '42501';
    end if;
  elsif p_kind = 'persona' then
    select workspace_id into v_ws from public.personas where id = p_id;
    if v_ws is null or not public.persona_edit_allowed(p_id, p_user) then
      raise exception 'You may not change this persona.' using errcode = '42501';
    end if;
  else
    raise exception 'kind must be template or persona' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;
  insert into public.pending_changes (workspace_id, kind, object_id, author, payload, base_updated_at)
  values (v_ws, p_kind, p_id, p_user, p_payload, p_base)
  on conflict (kind, object_id, author) do update
    set payload = excluded.payload, base_updated_at = excluded.base_updated_at, state = 'pending',
        note = null, decided_by = null, decided_at = null, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_change_for_user(text, uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.submit_change_for_user(text, uuid, jsonb, timestamptz, uuid) to service_role;

create or replace function public.submit_change(p_kind text, p_id uuid, p_payload jsonb, p_base timestamptz)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.submit_change_for_user(p_kind, p_id, p_payload, p_base, (select auth.uid()));
$$;
revoke all on function public.submit_change(text, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.submit_change(text, uuid, jsonb, timestamptz) to authenticated;

-- 5. Deciding -----------------------------------------------------------------------------------------
-- A moderator or admin releases (the payload is written as an ordinary change, credited to its author,
-- with the version note "Released after review") or rejects with a reason. If the object changed after
-- the submission, releasing needs p_force — the app shows both states first.
create or replace function public.decide_change(p_change_id uuid, p_release boolean, p_note text default null, p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.pending_changes;
  v_updated timestamptz;
  v_p jsonb;
  el jsonb;
  i integer;
begin
  select * into c from public.pending_changes where id = p_change_id;
  if c.id is null or not public.is_workspace_moderator(c.workspace_id, (select auth.uid())) then
    raise exception 'Only a moderator or an admin of this workspace can decide.' using errcode = '42501';
  end if;
  if c.state <> 'pending' then
    raise exception 'This change is not waiting for review.' using errcode = '22023';
  end if;
  if not p_release then
    update public.pending_changes set state = 'rejected', note = left(nullif(trim(p_note), ''), 500),
      decided_by = (select auth.uid()), decided_at = now(), updated_at = now() where id = c.id;
    return 'rejected';
  end if;

  if c.kind = 'template' then
    select updated_at into v_updated from public.prompts where id = c.object_id;
  else
    select updated_at into v_updated from public.personas where id = c.object_id;
  end if;
  if v_updated is null then
    raise exception 'The object no longer exists.' using errcode = '22023';
  end if;
  if c.base_updated_at is not null and v_updated > c.base_updated_at + interval '1 second' and not p_force then
    raise exception 'Changed since this was submitted.' using errcode = '40001';
  end if;

  v_p := c.payload;
  perform set_config('sqemes.review', 'on', true);
  perform set_config('sqemes.version_note', 'Released after review', true);
  if c.kind = 'template' then
    update public.prompts set
      title            = case when v_p ? 'title' then v_p->>'title' else title end,
      description      = case when v_p ? 'description' then v_p->>'description' else description end,
      content          = case when v_p ? 'content' then v_p->>'content' else content end,
      tag              = case when v_p ? 'tag' then nullif(v_p->>'tag', '') else tag end,
      kind             = case when v_p ? 'kind' then v_p->>'kind' else kind end,
      model            = case when v_p ? 'model' then nullif(v_p->>'model', '') else model end,
      variables        = case when v_p ? 'variables' then v_p->'variables' else variables end,
      context_file_ids = case when v_p ? 'context_file_ids'
                           then array(select jsonb_array_elements_text(v_p->'context_file_ids')::uuid) else context_file_ids end,
      updated_by       = c.author,
      updated_at       = now()
    where id = c.object_id;
    if v_p ? 'access' then
      delete from public.template_access where template_id = c.object_id;
      for el in select * from jsonb_array_elements(v_p->'access') loop
        insert into public.template_access (template_id, workspace_id, user_id, group_id, created_by)
        values (c.object_id, c.workspace_id, nullif(el->>'user_id', '')::uuid, nullif(el->>'group_id', '')::uuid, c.author);
      end loop;
    end if;
  else
    update public.personas set
      title       = case when v_p ? 'title' then v_p->>'title' else title end,
      description = case when v_p ? 'description' then v_p->>'description' else description end,
      content     = case when v_p ? 'content' then v_p->>'content' else content end,
      tags        = case when v_p ? 'tags' then array(select jsonb_array_elements_text(v_p->'tags')) else tags end,
      connectors  = case when v_p ? 'connectors' then v_p->'connectors' else connectors end,
      updated_at  = now()
    where id = c.object_id;
    if v_p ? 'routes' then
      delete from public.persona_templates where persona_id = c.object_id;
      i := 0;
      for el in select * from jsonb_array_elements(v_p->'routes') loop
        -- Only playbooks of the same workspace; anything else is skipped, never an error mid-release.
        insert into public.persona_templates (persona_id, template_id, condition, sort_order)
        select c.object_id, p.id, coalesce(el->>'condition', ''), i
          from public.prompts p where p.id = (el->>'template_id')::uuid and p.workspace_id = c.workspace_id
        on conflict do nothing;
        i := i + 1;
      end loop;
    end if;
    if v_p ? 'access' then
      delete from public.persona_access where persona_id = c.object_id;
      for el in select * from jsonb_array_elements(v_p->'access') loop
        insert into public.persona_access (persona_id, workspace_id, user_id, group_id, created_by)
        values (c.object_id, c.workspace_id, nullif(el->>'user_id', '')::uuid, nullif(el->>'group_id', '')::uuid, c.author);
      end loop;
    end if;
  end if;
  perform set_config('sqemes.version_note', '', true);
  perform set_config('sqemes.review', '', true);
  delete from public.pending_changes where id = c.id;
  return 'released';
end;
$$;
revoke all on function public.decide_change(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.decide_change(uuid, boolean, text, boolean) to authenticated;

-- 6. The locks for clients ----------------------------------------------------------------------------
-- A client (recognised by its uid — these are definers) that is no moderator may not write a shared
-- object's content, any released object's access, a shared persona's routes, or a file a shared playbook
-- uses, while the switch is on. The service role (MCP, Chat) is checked in the code, which submits
-- instead. decide_change opens the locks with sqemes.review.
create or replace function public.guard_moderated_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(current_setting('sqemes.review', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'prompts' then
    if (new.title, new.description, new.content, new.variables, new.kind, new.tag, new.context_file_ids, new.model)
       is not distinct from (old.title, old.description, old.content, old.variables, old.kind, old.tag, old.context_file_ids, old.model) then
      return new;
    end if;
    if public.changes_need_review(old.workspace_id, v_uid) and public.is_shared_object('template', old.id) then
      raise exception 'This playbook is shared and changes need review in this workspace. Submit the change for review.' using errcode = '42501';
    end if;
    return new;
  elsif tg_table_name = 'personas' then
    if (new.title, new.description, new.content, new.tags, new.connectors)
       is not distinct from (old.title, old.description, old.content, old.tags, old.connectors) then
      return new;
    end if;
    if public.changes_need_review(old.workspace_id, v_uid) and public.is_shared_object('persona', old.id) then
      raise exception 'This persona is shared and changes need review in this workspace. Submit the change for review.' using errcode = '42501';
    end if;
    return new;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.guard_moderated_change() from public, anon, authenticated;

drop trigger if exists guard_moderated_change on public.prompts;
create trigger guard_moderated_change before update on public.prompts
  for each row execute function public.guard_moderated_change();
drop trigger if exists guard_moderated_change on public.personas;
create trigger guard_moderated_change before update on public.personas
  for each row execute function public.guard_moderated_change();

create or replace function public.guard_moderated_relation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
  v_ws uuid;
  v_obj uuid;
begin
  if v_uid is null or coalesce(current_setting('sqemes.review', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  r := coalesce(new, old);
  if tg_table_name = 'template_access' then
    select workspace_id into v_ws from public.prompts where id = r.template_id;
    if v_ws is not null and public.changes_need_review(v_ws, v_uid)
       and exists (select 1 from public.prompts where id = r.template_id and review_state is null) then
      raise exception 'Who may see this playbook is a change that needs review in this workspace. Submit the change for review.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'persona_access' then
    select workspace_id into v_ws from public.personas where id = r.persona_id;
    if v_ws is not null and public.changes_need_review(v_ws, v_uid)
       and exists (select 1 from public.personas where id = r.persona_id and review_state is null) then
      raise exception 'Who may see this persona is a change that needs review in this workspace. Submit the change for review.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'persona_templates' then
    -- A route removed because its playbook is being deleted is not a change of the persona's choosing.
    if tg_op = 'DELETE' and not exists (select 1 from public.prompts where id = old.template_id) then
      return old;
    end if;
    select workspace_id into v_ws from public.personas where id = r.persona_id;
    if v_ws is not null and public.changes_need_review(v_ws, v_uid) and public.is_shared_object('persona', r.persona_id) then
      raise exception 'This persona is shared and changes to its playbooks need review in this workspace. Submit the change for review.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'workspace_files' then
    -- Possibility 2: a file a shared playbook uses is not replaced or deleted by a non-moderator.
    if tg_op = 'UPDATE' and new.storage_path is not distinct from old.storage_path and new.size_bytes is not distinct from old.size_bytes then
      return new;
    end if;
    if public.changes_need_review(old.workspace_id, v_uid)
       and exists (select 1 from public.prompts p where p.workspace_id = old.workspace_id and old.id = any(p.context_file_ids)
                     and public.is_shared_object('template', p.id)) then
      raise exception 'A shared playbook uses this file, so only a moderator or an admin can replace or delete it in this workspace. Upload a new file and submit the change of the playbook instead.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.guard_moderated_relation() from public, anon, authenticated;

drop trigger if exists guard_moderated_relation on public.template_access;
create trigger guard_moderated_relation before insert or delete on public.template_access
  for each row execute function public.guard_moderated_relation();
drop trigger if exists guard_moderated_relation on public.persona_access;
create trigger guard_moderated_relation before insert or delete on public.persona_access
  for each row execute function public.guard_moderated_relation();
drop trigger if exists guard_moderated_relation on public.persona_templates;
create trigger guard_moderated_relation before insert or update or delete on public.persona_templates
  for each row execute function public.guard_moderated_relation();
drop trigger if exists guard_moderated_relation on public.workspace_files;
create trigger guard_moderated_relation before update or delete on public.workspace_files
  for each row execute function public.guard_moderated_relation();

-- 7. Self-check ---------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.submit_change_for_user(text, uuid, jsonb, timestamptz, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.is_shared_object(text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.changes_need_review(uuid, uuid)', 'execute') then
    raise exception 'SQEM-667: a user-id helper is callable by clients';
  end if;
  if position('get_user_workspace_ids' in pg_get_functiondef('public.can_access_template(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'SQEM-667 self-check: can_access_template lost the tenant boundary';
  end if;
end $$;
