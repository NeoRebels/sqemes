-- SQEM-534 — a workspace default for "Who can edit" (SQEM-473): new playbooks and personas start
-- either open to every editor who can see them, or restricted to their creator and the admins.
--
-- Decided with SQEM-534: one setting for playbooks AND personas, and it applies to every way one is
-- created — the editor, the wizard, the library install, duplicating, and the MCP server. That is why
-- it is a TRIGGER and not code in each writer: the access default (`default_template_access`) is
-- applied writer by writer, and two of them (library install, duplicate) miss it to this day.
--
-- "Restricted to the creator" is exactly what SQEM-473 writes for "Only selected people" with nobody
-- ticked: one editor row naming the owner. Admins may always edit, so nothing becomes unchangeable.
-- Existing playbooks and personas are not touched; the default only shapes what is created after it.
--
-- ⛔ No RETURNING trap (SQEM-525): the trigger runs AFTER the insert and reads only NEW; the inserted
-- row's own SELECT policy is about sight, which this does not change.

-- 1. The setting -----------------------------------------------------------------------------------
alter table public.workspaces add column if not exists default_edit_restricted boolean not null default false;
comment on column public.workspaces.default_edit_restricted is
  'SQEM-534 — new playbooks and personas start with "Who can edit" restricted to their creator (and admins). Admins only; see guard_default_edit_restricted.';

-- Writable through the client's settings path (column grants since SQEM-109)…
grant update (default_edit_restricted) on public.workspaces to authenticated;

-- …but by an admin only. The workspaces UPDATE policy admits editors too (they reach General), so the
-- column is guarded here: anyone else's write keeps the old value, and a client insert starts false.
create or replace function public.guard_default_edit_restricted()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.default_edit_restricted := false;
  elsif new.default_edit_restricted is distinct from old.default_edit_restricted
        and public.get_user_role(old.id) is distinct from 'admin' then
    new.default_edit_restricted := old.default_edit_restricted;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_default_edit_restricted on public.workspaces;
create trigger guard_default_edit_restricted before insert or update on public.workspaces
  for each row execute function public.guard_default_edit_restricted();

-- 2. Applying it -----------------------------------------------------------------------------------
-- SECURITY DEFINER: the editor lists are written only by the owner or an admin under RLS, and a
-- creator writing through the MCP server is neither as far as the database knows (service role).
-- Without an owner nothing is written — "only nobody" cannot be expressed, and no row means open.
create or replace function public.apply_default_edit_restriction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null
     or not exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.default_edit_restricted) then
    return null;
  end if;
  if tg_table_name = 'prompts' then
    insert into public.template_editors (template_id, workspace_id, user_id, created_by)
    values (new.id, new.workspace_id, new.created_by, new.created_by)
    on conflict do nothing;
  else
    insert into public.persona_editors (persona_id, workspace_id, user_id, created_by)
    values (new.id, new.workspace_id, new.created_by, new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.apply_default_edit_restriction() from public, anon, authenticated;

drop trigger if exists apply_default_edit_restriction on public.prompts;
create trigger apply_default_edit_restriction after insert on public.prompts
  for each row execute function public.apply_default_edit_restriction();

drop trigger if exists apply_default_edit_restriction on public.personas;
create trigger apply_default_edit_restriction after insert on public.personas
  for each row execute function public.apply_default_edit_restriction();
