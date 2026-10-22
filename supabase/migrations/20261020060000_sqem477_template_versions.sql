-- SQEM-477 — version history for playbooks: every change keeps the state it produced, any earlier
-- state can be looked at, compared and restored. Restoring writes a NEW version noting where it came
-- from; nothing is ever overwritten.
--
-- Decided with SQEM-477: playbooks only (personas are not versioned); of the context files only the
-- attached LIST is versioned, not their content — a file deleted since cannot come back, and a
-- restore says which ones are missing instead of pretending.
--
-- ⛔ Recorded by a TRIGGER, not by the writers. Playbooks are written by the editor, the library
-- install, and four MCP paths (create, update, import, file swap); a version that depends on each
-- writer remembering it is one forgotten path away from a gap (the SQEM-336 lesson). The trigger
-- writes only when a versioned field changed, so the usage counter and the favourite flag — both
-- stored on `prompts` — never produce a version.
--
-- ⛔ No function here looks up a row RETURNING could miss (SQEM-525): the trigger runs AFTER the
-- write and reads only NEW; the policies read existing rows.

-- 1. Who changed it --------------------------------------------------------------------------------
-- Client writes get it from the guard trigger (auth.uid(), unforgeable). Service writes (the MCP
-- server) set it themselves, because auth.uid() is empty there.
alter table public.prompts add column if not exists updated_by uuid references auth.users (id) on delete set null;

create or replace function public.guard_client_owned_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    new.workspace_id := old.workspace_id;
    if tg_table_name in ('prompts', 'personas') then
      new.usage_count := old.usage_count;
    end if;
  end if;
  -- SQEM-477 — the author of the version this write produces.
  if tg_table_name = 'prompts' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- 2. The versions ----------------------------------------------------------------------------------
create table if not exists public.template_versions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.prompts (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  version       integer not null,
  title         text,
  description   text,
  content       text,
  variables     jsonb,
  kind          text,
  tag           text,
  -- [{id, name}] in attachment order. The name is kept so a deleted file still shows as itself.
  context_files jsonb not null default '[]'::jsonb,
  note          text,
  restored_from integer,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint template_versions_number_uq unique (template_id, version)
);
create index if not exists template_versions_workspace_idx on public.template_versions (workspace_id);

alter table public.template_versions enable row level security;
revoke all on public.template_versions from anon, authenticated;
-- No insert or update for clients: versions come from the trigger only.
grant select, delete on public.template_versions to authenticated;

-- Visible exactly when the playbook is: the subquery runs under prompts' own RLS.
drop policy if exists template_versions_select on public.template_versions;
create policy template_versions_select on public.template_versions
  for select to authenticated
  using (exists (select 1 from public.prompts p where p.id = template_versions.template_id));

drop policy if exists template_versions_delete on public.template_versions;
create policy template_versions_delete on public.template_versions
  for delete to authenticated
  using (public.can_edit_template(template_id));

-- The newest version is the current state and cannot be deleted by a client. A playbook's own
-- deletion cascades as the table owner and is not affected.
create or replace function public.guard_latest_template_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.version = (select max(v.version) from public.template_versions v where v.template_id = old.template_id) then
    raise exception 'The current version cannot be deleted.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_latest_template_version on public.template_versions;
create trigger guard_latest_template_version before delete on public.template_versions
  for each row execute function public.guard_latest_template_version();

-- 3. Recording -------------------------------------------------------------------------------------
-- SECURITY DEFINER because clients may not insert versions themselves. The note and the source of a
-- restore come from restore_template_version() through transaction-local settings.
create or replace function public.record_template_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next  integer;
  v_files jsonb;
begin
  if tg_op = 'UPDATE'
     and (new.title, new.description, new.content, new.variables, new.kind, new.tag, new.context_file_ids)
         is not distinct from
         (old.title, old.description, old.content, old.variables, old.kind, old.tag, old.context_file_ids) then
    return null;
  end if;

  -- The UPDATE holds the playbook's row lock, so two saves of one playbook number in turn; the
  -- unique constraint is the backstop.
  select coalesce(max(version), 0) + 1 into v_next from public.template_versions where template_id = new.id;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', wf.name) order by f.ord), '[]'::jsonb)
    into v_files
    from unnest(coalesce(new.context_file_ids, '{}'::uuid[])) with ordinality as f(id, ord)
    left join public.workspace_files wf on wf.id = f.id;

  insert into public.template_versions
    (template_id, workspace_id, version, title, description, content, variables, kind, tag,
     context_files, note, restored_from, created_by)
  values
    (new.id, new.workspace_id, v_next, new.title, new.description, new.content, new.variables, new.kind, new.tag,
     v_files,
     nullif(current_setting('sqemes.version_note', true), ''),
     nullif(current_setting('sqemes.restored_from', true), '')::integer,
     case when tg_op = 'INSERT' then coalesce(new.updated_by, new.created_by) else new.updated_by end);
  return null;
end;
$$;

revoke all on function public.record_template_version() from public, anon, authenticated;

drop trigger if exists record_template_version on public.prompts;
create trigger record_template_version after insert or update on public.prompts
  for each row execute function public.record_template_version();

-- 4. Restoring -------------------------------------------------------------------------------------
-- Which of a version's files still exist. DEFINER because a file detached since may no longer be
-- visible to the caller under workspace_files' RLS, and would wrongly read as deleted. Answers only
-- for a version the caller can see, and only with ids that version already lists.
create or replace function public.template_version_files_present(p_version_id uuid)
 returns setof uuid
 language sql stable security definer set search_path to 'public'
as $function$
  select wf.id
    from public.template_versions v
    join public.prompts p on p.id = v.template_id
    join public.workspace_files wf
      on wf.workspace_id = v.workspace_id
     and wf.id in (select (f->>'id')::uuid from jsonb_array_elements(v.context_files) f)
   where v.id = p_version_id
     and exists (select 1 from public.workspace_members wm where wm.workspace_id = p.workspace_id and wm.user_id = auth.uid())
     and (p.created_by = auth.uid() or public.can_access_template(p.id, p.workspace_id, p.created_by));
$function$;

-- INVOKER: the playbook UPDATE below runs under the caller's RLS, so restoring needs exactly the
-- right to edit (SQEM-473) — no second rule to keep in step.
create or replace function public.restore_template_version(p_version_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v       public.template_versions%rowtype;
  v_keep  uuid[];
  v_miss  jsonb;
  v_rows  integer;
  v_new   integer;
begin
  select * into v from public.template_versions where id = p_version_id;
  if not found then
    raise exception 'Version not found.' using errcode = 'P0002';
  end if;

  select coalesce(array_agg((f->>'id')::uuid order by ord), '{}'::uuid[])
    into v_keep
    from jsonb_array_elements(v.context_files) with ordinality as x(f, ord)
   where (f->>'id')::uuid in (select public.template_version_files_present(p_version_id));

  select coalesce(jsonb_agg(coalesce(f->>'name', f->>'id') order by ord), '[]'::jsonb)
    into v_miss
    from jsonb_array_elements(v.context_files) with ordinality as x(f, ord)
   where not ((f->>'id')::uuid = any (v_keep));

  perform set_config('sqemes.version_note', 'Restored from version ' || v.version, true);
  perform set_config('sqemes.restored_from', v.version::text, true);

  update public.prompts
     set title = v.title, description = v.description, content = v.content, variables = v.variables,
         kind = v.kind, tag = v.tag, context_file_ids = v_keep, updated_at = now()
   where id = v.template_id;
  get diagnostics v_rows = row_count;

  perform set_config('sqemes.version_note', '', true);
  perform set_config('sqemes.restored_from', '', true);

  if v_rows = 0 then
    raise exception 'You may use this playbook but not change it.' using errcode = '42501';
  end if;

  -- Null when the restored state equals the current one: nothing changed, so no version was written.
  select max(version) into v_new from public.template_versions
   where template_id = v.template_id and restored_from = v.version and created_at = now();

  return jsonb_build_object('version', v_new, 'missingFiles', v_miss);
end;
$function$;

revoke all on function public.template_version_files_present(uuid) from public, anon;
revoke all on function public.restore_template_version(uuid)       from public, anon;
grant execute on function public.template_version_files_present(uuid), public.restore_template_version(uuid) to authenticated, service_role;

-- 5. The history starts here -----------------------------------------------------------------------
-- One version for every existing playbook: its state today. No author — who wrote it is not known.
insert into public.template_versions
  (template_id, workspace_id, version, title, description, content, variables, kind, tag, context_files, note, created_at)
select p.id, p.workspace_id, 1, p.title, p.description, p.content, p.variables, p.kind, p.tag,
       coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', wf.name) order by f.ord)
                   from unnest(coalesce(p.context_file_ids, '{}'::uuid[])) with ordinality as f(id, ord)
                   left join public.workspace_files wf on wf.id = f.id), '[]'::jsonb),
       'History starts here', coalesce(p.updated_at, p.created_at, now())
  from public.prompts p
 where not exists (select 1 from public.template_versions v where v.template_id = p.id);
