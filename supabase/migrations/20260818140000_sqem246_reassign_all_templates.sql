-- ============================================================
-- SQEM-246 — a departure leaves no template ownerless
-- ============================================================
--
-- `reassign_private_templates()` (SQEM-212) hands over only templates carrying the principal-less
-- row, because at the time only those became *unreachable* when their creator left. A shared
-- template of the same person simply lost its `created_by` and nobody minded.
--
-- **SQEM-240 changed what that costs.** "Only me" is now refused on a template with no owner —
-- `can_access_template` matches the creator by id and NULL matches nobody, so choosing it would hide
-- the template from everyone including whoever picked it. A shared template orphaned by a departure
-- therefore loses a feature permanently, and nobody did anything wrong to earn that.
--
-- SQEM-241 healed the 47 rows that had accumulated. This closes the source: **every** template of a
-- departing member is handed to the longest-standing remaining admin, not only the private ones.
--
-- ⚠️ **This assigns custody, not authorship** — the same wording as SQEM-241, and it matters more
-- here, because a *shared* template now changes hands too. `created_by` answers "who is responsible
-- for this now", not "who wrote it". Anything that reads it as a byline is wrong and was already
-- wrong before this migration.
--
-- The name goes with the meaning. `reassign_private_templates` would be a lie after this change, and
-- a function whose name contradicts its body is worse than one with an awkward name.
--
-- Unchanged and deliberate: **a workspace with no admin left is not touched.** Handing a departed
-- colleague's template to an arbitrary member breaks the promise harder than an ownerless row does.

create or replace function public.reassign_orphaned_templates(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  -- The longest-standing admin still in the workspace. `workspaces` has no owner column (no
  -- `created_by`, no `owner_id`), so `workspace_members.joined_at` is the only available notion of
  -- "first admin" — and taking the longest-standing *current* one answers "what if the first has
  -- gone" by construction.
  select wm.user_id into target
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.role = 'admin'
    and wm.user_id <> p_user_id
  order by wm.joined_at asc
  limit 1;

  if target is null then
    return;
  end if;

  -- SQEM-246 — no longer filtered to templates with the principal-less row.
  update public.prompts p
  set created_by = target
  where p.workspace_id = p_workspace_id
    and p.created_by = p_user_id;
end;
$$;

comment on function public.reassign_orphaned_templates(uuid, uuid) is
  'SQEM-246 (was reassign_private_templates, SQEM-212) — on departure, hands EVERY template of the '
  'leaving member to the longest-standing remaining admin. Private ones would otherwise be '
  'unreachable; shared ones would be ownerless, which since SQEM-240 permanently disables "Only me" '
  'on them. Assigns custody, not authorship. A workspace with no admin is left alone.';

-- The two callers, repointed. Bodies otherwise unchanged from SQEM-212 — including the reason each
-- one is shaped the way it is, because deleting that reasoning is how it gets undone later.

-- Removed from a workspace (or left it).
create or replace function public.on_workspace_member_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a whole workspace cascades its member rows through here. There is nothing to hand over
  -- then — the prompts are going too — so check the workspace still exists before touching it.
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform public.reassign_orphaned_templates(old.workspace_id, old.user_id);
  end if;
  return old;
end;
$$;

-- Account deleted. Deliberately BEFORE the delete: `prompts.created_by` is a foreign key with
-- `on delete set null`, and the order in which two foreign-key actions run is not defined — relying
-- on the membership cascade to get there first would be a coin flip.
create or replace function public.on_profile_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws record;
begin
  for ws in select workspace_id from public.workspace_members where user_id = old.id loop
    perform public.reassign_orphaned_templates(ws.workspace_id, old.id);
  end loop;
  return old;
end;
$$;

-- Only now, once nothing calls it any more.
drop function if exists public.reassign_private_templates(uuid, uuid);
