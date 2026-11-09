-- SQEM-666 — Moderation, part 1: new playbooks and personas are checked before the team sees them.
--
-- Settings → Security → Moderation (admins only): a switch, and the people who moderate — editors and
-- admins only. Admins always moderate, listed or not.
--
-- ⛔ The mechanism is a gate on SIGHT, not on writing access rows (decided 2026-11-08). Access is saved
-- as "delete the rows, write new ones", and no rows means "everyone" — a row trigger cannot tell a
-- widening from a delete. So every new playbook or persona of a non-moderator carries a review state
-- while the switch is on, and the access functions consult it before the access rows:
--   draft    — only the owner sees it ("only me" stays private, also from moderators)
--   pending  — submitted: the owner, the moderators and the admins see it
--   rejected — only the owner, with the reason in review_note
--   null     — released (or never under review): the access rows the owner chose apply as always
-- The rows are never rewritten by a decision; releasing just clears the state. One gate in the three
-- access functions covers the app (RLS), MCP and Chat (service role) and the extension at once.
--
-- Deliberately not here: changes to something already released, access changes included (SQEM-667).

-- 1. The switch --------------------------------------------------------------------------------------
alter table public.workspaces add column if not exists moderation_new boolean not null default false;
comment on column public.workspaces.moderation_new is
  'SQEM-666 — new playbooks and personas of non-moderators start in review_state draft. Admins only; see guard_moderation_new.';
grant update (moderation_new) on public.workspaces to authenticated;

create or replace function public.guard_moderation_new()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.moderation_new := false;
  elsif new.moderation_new is distinct from old.moderation_new
        and public.get_user_role(old.id) is distinct from 'admin' then
    new.moderation_new := old.moderation_new;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_moderation_new on public.workspaces;
create trigger guard_moderation_new before insert or update on public.workspaces
  for each row execute function public.guard_moderation_new();

-- 2. Who moderates -----------------------------------------------------------------------------------
-- ⭐ The foreign key on the MEMBERSHIP (not the profile) removes the entry when someone leaves.
create table if not exists public.workspace_moderators (
  workspace_id uuid not null,
  user_id uuid not null,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
comment on table public.workspace_moderators is
  'SQEM-666 — who moderates submissions besides the admins. Editors and admins only (guard_workspace_moderator); a demotion to member removes the row (drop_demoted_moderator), leaving the workspace removes it by the foreign key.';

alter table public.workspace_moderators enable row level security;

create policy "workspace_moderators_select" on public.workspace_moderators for select to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));
create policy "workspace_moderators_insert" on public.workspace_moderators for insert to authenticated
  with check (public.get_user_role(workspace_id) = 'admin');
create policy "workspace_moderators_delete" on public.workspace_moderators for delete to authenticated
  using (public.get_user_role(workspace_id) = 'admin');

grant select, insert, delete on public.workspace_moderators to authenticated;

-- A member cannot be a moderator: refused at the door, whoever writes.
create or replace function public.guard_workspace_moderator()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = new.workspace_id and m.user_id = new.user_id and m.role in ('admin', 'editor')
  ) then
    raise exception 'Only editors and admins can moderate.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_workspace_moderator on public.workspace_moderators;
create trigger guard_workspace_moderator before insert or update on public.workspace_moderators
  for each row execute function public.guard_workspace_moderator();

-- Demoted to member → out. SECURITY DEFINER: the admin who demotes may not hold a delete right that
-- reaches the row by RLS in every path (the role change can also come from the service role).
create or replace function public.drop_demoted_moderator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'member' and old.role is distinct from 'member' then
    delete from public.workspace_moderators where workspace_id = new.workspace_id and user_id = new.user_id;
  end if;
  return null;
end;
$$;
revoke all on function public.drop_demoted_moderator() from public, anon, authenticated;

drop trigger if exists drop_demoted_moderator on public.workspace_members;
create trigger drop_demoted_moderator after update of role on public.workspace_members
  for each row execute function public.drop_demoted_moderator();

-- Admins always; editors when listed. Asked for a given person — the access functions below pass
-- auth.uid() or the MCP caller.
create or replace function public.is_workspace_moderator(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select m.role = 'admin'
        or (m.role = 'editor' and exists (
              select 1 from public.workspace_moderators w
              where w.workspace_id = p_workspace_id and w.user_id = p_user_id))
    from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ), false);
$$;
revoke all on function public.is_workspace_moderator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_workspace_moderator(uuid, uuid) to service_role;

-- 3. The review state --------------------------------------------------------------------------------
alter table public.prompts
  add column if not exists review_state text check (review_state in ('draft', 'pending', 'rejected')),
  add column if not exists review_note text,
  add column if not exists review_submitted_at timestamptz,
  add column if not exists review_decided_by uuid references public.profiles on delete set null,
  add column if not exists review_decided_at timestamptz;
alter table public.personas
  add column if not exists review_state text check (review_state in ('draft', 'pending', 'rejected')),
  add column if not exists review_note text,
  add column if not exists review_submitted_at timestamptz,
  add column if not exists review_decided_by uuid references public.profiles on delete set null,
  add column if not exists review_decided_at timestamptz;
create index if not exists prompts_review_pending on public.prompts (workspace_id) where review_state = 'pending';
create index if not exists personas_review_pending on public.personas (workspace_id) where review_state = 'pending';

-- ⚠️ Named so it fires AFTER guard_client_owned_columns (BEFORE triggers run in name order): that one sets
-- created_by = auth.uid() for a client insert, and the owner is what this one decides on.
-- Set on INSERT for every writer (editor, wizard, library install, duplicate, MCP, Chat); the value a
-- client sends is ignored. On UPDATE a client may change the review columns only through the two RPCs
-- below (they set sqemes.review for their transaction); otherwise the old values are kept.
create or replace function public.guard_review_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.review_note := null; new.review_submitted_at := null; new.review_decided_by := null; new.review_decided_at := null;
    if new.created_by is not null
       and exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.moderation_new)
       and not public.is_workspace_moderator(new.workspace_id, new.created_by) then
      new.review_state := 'draft';
    else
      new.review_state := null;
    end if;
    return new;
  end if;
  -- ⚠️ current_user is the definer here, never 'authenticated': a client is recognised by its uid. The
  -- service role (MCP, Chat) has none and may write; the two RPCs open the guard with sqemes.review.
  if (select auth.uid()) is not null and coalesce(current_setting('sqemes.review', true), '') <> 'on' then
    new.review_state := old.review_state;
    new.review_note := old.review_note;
    new.review_submitted_at := old.review_submitted_at;
    new.review_decided_by := old.review_decided_by;
    new.review_decided_at := old.review_decided_at;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_review_state() from public, anon, authenticated;

drop trigger if exists guard_review_state on public.prompts;
create trigger guard_review_state before insert or update on public.prompts
  for each row execute function public.guard_review_state();
drop trigger if exists guard_review_state on public.personas;
create trigger guard_review_state before insert or update on public.personas
  for each row execute function public.guard_review_state();

-- 4. The gate in the access functions ----------------------------------------------------------------
-- Built on the CURRENT definitions — can_access_template with the SQEM-505 tenant boundary,
-- can_access_persona in its SQEM-525 form (the boundary turned round so an INSERT … RETURNING passes) —
-- and unchanged apart from the review state: the owner always; released → the access rows as before;
-- pending → moderators and admins; draft or rejected → nobody else.
-- ⛔ The first draft of this migration copied the SQEM-292/324 versions (a lower-case search missed the
-- upper-case CREATE OR REPLACE of SQEM-505) and dropped the tenant boundary; the isolation suite caught it.
-- The self-check at the end now pins the boundary in both.
create or replace function public.can_access_template(
  p_template_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_workspace_id in (select public.get_user_workspace_ids())
    and (
    p_created_by = (select auth.uid())
    or case (select p.review_state from public.prompts p where p.id = p_template_id)
      when 'pending' then public.is_workspace_moderator(p_workspace_id, (select auth.uid()))
      when 'draft' then false
      when 'rejected' then false
      else (
        not exists (
          select 1 from public.template_access ta
          where ta.template_id = p_template_id
            and ta.role is null and ta.user_id is null and ta.group_id is null
        )
        and (
          not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
          or public.is_named_on_template(p_template_id, p_workspace_id, (select auth.uid()))
        )
      )
    end
    );
$$;

create or replace function public.mcp_accessible_template_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.prompts p
  where p.workspace_id = p_workspace_id
    and (
      p.created_by = p_user_id
      or case p.review_state
        when 'pending' then public.is_workspace_moderator(p_workspace_id, p_user_id)
        when 'draft' then false
        when 'rejected' then false
        else (
          not exists (
            select 1 from public.template_access ta
            where ta.template_id = p.id
              and ta.role is null and ta.user_id is null and ta.group_id is null
          )
          and (
            not exists (select 1 from public.template_access ta where ta.template_id = p.id)
            or public.is_named_on_template(p.id, p_workspace_id, p_user_id)
          )
        )
      end
    );
$$;

create or replace function public.can_access_persona(
  p_persona_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    not exists (select 1 from public.personas pe
                where pe.id = p_persona_id and pe.workspace_id not in (select public.get_user_workspace_ids()))
    and (
    p_created_by = (select auth.uid())
    or case (select p.review_state from public.personas p where p.id = p_persona_id)
      when 'pending' then public.is_workspace_moderator(
        (select p.workspace_id from public.personas p where p.id = p_persona_id), (select auth.uid()))
      when 'draft' then false
      when 'rejected' then false
      else (
        not exists (
          select 1 from public.persona_access pa
          where pa.persona_id = p_persona_id
            and pa.user_id is null and pa.group_id is null
        )
        and (
          not exists (select 1 from public.persona_access pa where pa.persona_id = p_persona_id)
          or public.is_named_on_persona(p_persona_id, (select auth.uid()))
        )
      )
    end
    );
$$;

create or replace function public.mcp_accessible_persona_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.personas p
  where p.workspace_id = p_workspace_id
    and (
      p.created_by = p_user_id
      or case p.review_state
        when 'pending' then public.is_workspace_moderator(p_workspace_id, p_user_id)
        when 'draft' then false
        when 'rejected' then false
        else (
          not exists (
            select 1 from public.persona_access pa
            where pa.persona_id = p.id and pa.user_id is null and pa.group_id is null
          )
          and (
            not exists (select 1 from public.persona_access pa where pa.persona_id = p.id)
            or public.is_named_on_persona(p.id, p_user_id)
          )
        )
      end
    );
$$;

-- The grants these functions had are unchanged by CREATE OR REPLACE; SQEM-503 still holds.

-- 5. Submitting and deciding -------------------------------------------------------------------------
-- Submit: the OWNER, from draft or rejected. Withdraw: the owner, from pending back to draft.
-- INVOKER: the owner's own update right decides, the setting only opens the guard.
create or replace function public.submit_for_review(p_kind text, p_id uuid, p_withdraw boolean default false)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid; v_state text; v_next text;
begin
  if p_kind = 'template' then
    select created_by, review_state into v_owner, v_state from public.prompts where id = p_id;
  elsif p_kind = 'persona' then
    select created_by, review_state into v_owner, v_state from public.personas where id = p_id;
  else
    raise exception 'kind must be template or persona' using errcode = '22023';
  end if;
  if v_owner is null or v_owner is distinct from (select auth.uid()) then
    raise exception 'Only the owner can submit this for review.' using errcode = '42501';
  end if;
  if p_withdraw then
    if v_state is distinct from 'pending' then return v_state; end if;
    v_next := 'draft';
  else
    if v_state not in ('draft', 'rejected') then return v_state; end if;
    v_next := 'pending';
  end if;
  perform set_config('sqemes.review', 'on', true);
  if p_kind = 'template' then
    update public.prompts set review_state = v_next, review_submitted_at = case when v_next = 'pending' then now() else review_submitted_at end
      where id = p_id;
  else
    update public.personas set review_state = v_next, review_submitted_at = case when v_next = 'pending' then now() else review_submitted_at end
      where id = p_id;
  end if;
  perform set_config('sqemes.review', '', true);
  return v_next;
end;
$$;
revoke all on function public.submit_for_review(text, uuid, boolean) from public, anon;
grant execute on function public.submit_for_review(text, uuid, boolean) to authenticated;

-- Decide: a moderator or admin of that workspace, on something pending. DEFINER: a moderator may have
-- no edit right on the object (SQEM-473 editor lists), and releasing is not an edit of its content.
create or replace function public.decide_review(p_kind text, p_id uuid, p_release boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid; v_state text; v_next text;
begin
  if p_kind = 'template' then
    select workspace_id, review_state into v_ws, v_state from public.prompts where id = p_id;
  elsif p_kind = 'persona' then
    select workspace_id, review_state into v_ws, v_state from public.personas where id = p_id;
  else
    raise exception 'kind must be template or persona' using errcode = '22023';
  end if;
  if v_ws is null or not public.is_workspace_moderator(v_ws, (select auth.uid())) then
    raise exception 'Only a moderator or an admin of this workspace can decide.' using errcode = '42501';
  end if;
  if v_state is distinct from 'pending' then
    raise exception 'This is not waiting for review.' using errcode = '22023';
  end if;
  v_next := case when p_release then null else 'rejected' end;
  perform set_config('sqemes.review', 'on', true);
  if p_kind = 'template' then
    update public.prompts set review_state = v_next, review_note = case when p_release then null else left(nullif(trim(p_note), ''), 500) end,
      review_decided_by = (select auth.uid()), review_decided_at = now() where id = p_id;
  else
    update public.personas set review_state = v_next, review_note = case when p_release then null else left(nullif(trim(p_note), ''), 500) end,
      review_decided_by = (select auth.uid()), review_decided_at = now() where id = p_id;
  end if;
  perform set_config('sqemes.review', '', true);
  return coalesce(v_next, 'released');
end;
$$;
revoke all on function public.decide_review(text, uuid, boolean, text) from public, anon;
grant execute on function public.decide_review(text, uuid, boolean, text) to authenticated;

-- 6. Self-check ---------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.is_workspace_moderator(uuid, uuid)', 'execute') then
    raise exception 'SQEM-666: is_workspace_moderator must not be callable by clients';
  end if;
  if not has_function_privilege('authenticated', 'public.can_access_template(uuid, uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.can_access_persona(uuid, uuid)', 'execute') then
    raise exception 'SQEM-666: the RLS access helpers must stay callable by authenticated';
  end if;
  if has_function_privilege('authenticated', 'public.mcp_accessible_template_ids(uuid, uuid)', 'execute') then
    raise exception 'SQEM-666: mcp_accessible_template_ids must stay service-only';
  end if;
  if position('get_user_workspace_ids' in pg_get_functiondef('public.can_access_template(uuid, uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'SQEM-666 self-check: can_access_template lost the SQEM-505 tenant boundary';
  end if;
  if position('workspace_id not in' in pg_get_functiondef('public.can_access_persona(uuid, uuid)'::regprocedure)) = 0 then
    raise exception 'SQEM-666 self-check: can_access_persona lost the SQEM-505/525 tenant boundary';
  end if;
end $$;
