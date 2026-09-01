-- ============================================================
-- SQEM-292 — access groups, and "Restrict access" starts meaning what it says
-- ============================================================
--
-- Until now `can_access_template()` carried this line:
--
--   public.get_user_role(p_workspace_id) in ('admin', 'editor')
--
-- so restricting a template to three people still shared it with every admin and every editor in the
-- workspace. That asymmetry was deliberate when it was written (SQEM-212: *"restrict access picks a
-- subset of the team and the people who run the workspace come along; only me is a promise to one
-- person"*). **The owner has removed it (2026-08-30): both are promises now.**
--
--   Access is: whoever created the template, and whoever is named. Nobody else.
--
-- ============================================================
-- ⚠️ THIS TIGHTENS EXISTING DATA, WITHOUT ANYONE DOING ANYTHING
-- ============================================================
--
-- A template with `user_id` rows was visible to admins and editors yesterday and is not today. No
-- row changes; the rule around it does. That is the intent — but it is the kind of change that has
-- to be announced rather than shipped quietly, because the people who lose access did nothing and
-- will not be told by the product.
--
-- Two shapes are deliberately untouched: a template with **no** rows stays open to the workspace,
-- and "only me" (the principal-less row) stays exactly as it was.
--
-- ============================================================
-- What replaces the roles: groups
-- ============================================================
--
-- `template_access` gains `group_id` as a third principal rather than a table of its own. A separate
-- table would mean access is answered in two places, and `can_access_template()` and
-- `mcp_accessible_template_ids()` would both have to know both. Those two already answer the same
-- question for different callers — the app and Chat go through RLS, MCP goes through the id list —
-- so they must be changed together or they drift apart silently, and nothing fails loudly when they
-- do: one channel simply starts showing a template the other hides.
--
-- (SQEM-299 — this sentence used to point at an internal document by name. That document is pruned
-- from the public export while this migration is not, so a self-hoster read a reference to something
-- they do not have. Edited on 2026-08-31 with the owner's explicit authorisation, since the migration
-- had already reached production; a comment only, no SQL touched, and Supabase tracks migrations by
-- version rather than by content. **A reason beats a reference** — which is why the warning is now
-- spelled out here instead of cited.)
--
-- The legacy `role` column stays and is still read. It is no longer written by the app (SQEM-211),
-- and the rows that exist are candidates for becoming groups — but **not automatically**: a group
-- freezes today's membership, while the role kept growing. Someone who becomes an editor tomorrow
-- would silently not be in it. That offer belongs in the interface, to a person who can weigh it.

-- ── Groups ───────────────────────────────────────────────────────────────────

create table if not exists public.workspace_groups (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);

-- One name per workspace: two groups called "Marketing" is a support ticket waiting to happen, and
-- the picker gives no way to tell them apart.
create unique index if not exists workspace_groups_name_uq
  on public.workspace_groups (workspace_id, lower(name));
create index if not exists workspace_groups_workspace_idx
  on public.workspace_groups (workspace_id);

create table if not exists public.workspace_group_members (
  group_id   uuid not null references public.workspace_groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists workspace_group_members_user_idx
  on public.workspace_group_members (user_id);

-- ── template_access gains a third principal ──────────────────────────────────

alter table public.template_access
  add column if not exists group_id uuid references public.workspace_groups (id) on delete cascade;

-- Still "at most one principal per row" — three options now instead of two. Zero remains legal and
-- still means "only me".
alter table public.template_access drop constraint if exists template_access_one_principal;
alter table public.template_access add constraint template_access_one_principal
  check ((role is not null)::int + (user_id is not null)::int + (group_id is not null)::int <= 1);

create unique index if not exists template_access_group_uq
  on public.template_access (template_id, group_id) where group_id is not null;

-- ⚠️ The private-row index must be re-created: it was partial on `role is null and user_id is null`,
-- which a group row now also satisfies. Without this, adding a group to a template would collide
-- with the "only me" uniqueness constraint — a failure that looks like a permissions bug.
drop index if exists public.template_access_private_uq;
create unique index template_access_private_uq
  on public.template_access (template_id)
  where role is null and user_id is null and group_id is null;

-- ── RLS on the new tables ────────────────────────────────────────────────────
--
-- Decided by the owner (2026-08-31): **admins manage group membership, editors may use groups.**
-- An editor who could add themselves to a group could grant themselves access to anything that group
-- can reach — the permission would be worth as much as the strongest group in the workspace.

alter table public.workspace_groups        enable row level security;
alter table public.workspace_group_members enable row level security;

-- Everyone in the workspace may READ groups: the access dialog has to render names, and an editor
-- restricting a template needs to pick from them. Reading a group name grants nothing.
create policy "workspace_groups_select"
  on public.workspace_groups for select
  to authenticated
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

create policy "workspace_groups_admin_write"
  on public.workspace_groups for all
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_groups.workspace_id
        and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_groups.workspace_id
        and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

create policy "workspace_group_members_select"
  on public.workspace_group_members for select
  to authenticated
  using (
    group_id in (
      select g.id from public.workspace_groups g
      join public.workspace_members wm on wm.workspace_id = g.workspace_id
      where wm.user_id = auth.uid()
    )
  );

create policy "workspace_group_members_admin_write"
  on public.workspace_group_members for all
  to authenticated
  using (
    group_id in (
      select g.id from public.workspace_groups g
      join public.workspace_members wm on wm.workspace_id = g.workspace_id
      where wm.user_id = auth.uid() and wm.role = 'admin'
    )
  )
  with check (
    group_id in (
      select g.id from public.workspace_groups g
      join public.workspace_members wm on wm.workspace_id = g.workspace_id
      where wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- ── The access rule, in one place ────────────────────────────────────────────
--
-- Both functions below need "is this user named on this template", and that question now has three
-- answers (person, group, legacy role). Writing it twice is how the two drift apart, so it lives
-- here once.

create or replace function public.is_named_on_template(
  p_template_id uuid, p_workspace_id uuid, p_user_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.template_access ta
    where ta.template_id = p_template_id
      and (
        ta.user_id = p_user_id
        or ta.group_id in (
          select gm.group_id from public.workspace_group_members gm where gm.user_id = p_user_id
        )
        -- Legacy: role rows still resolve, so nothing that worked yesterday breaks today. Nothing
        -- writes them any more (SQEM-211).
        or ta.role = (
          select wm.role from public.workspace_members wm
          where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id limit 1
        )
      )
  );
$$;

comment on function public.is_named_on_template(uuid, uuid, uuid) is
  'SQEM-292 — is this user explicitly granted access to this template, by person, group, or legacy role? Called by can_access_template() and mcp_accessible_template_ids() so the two cannot answer differently.';

-- ── can_access_template — app and Chat ───────────────────────────────────────
--
-- Shorter than before: the admin/editor branch is gone, and the three principal checks collapse into
-- one call.

create or replace function public.can_access_template(
  p_template_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = (select auth.uid())
    or (
      not exists (
        select 1 from public.template_access ta
        where ta.template_id = p_template_id
          and ta.role is null and ta.user_id is null and ta.group_id is null
      )
      and (
        not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
        or public.is_named_on_template(p_template_id, p_workspace_id, (select auth.uid()))
      )
    );
$$;

comment on function public.can_access_template(uuid, uuid, uuid) is
  'SQEM-292 — the creator, or whoever is named (person/group/legacy role). Admins and editors no longer get automatic access: that made "Restrict access" mean something other than what it said. Emergency access is reassign_orphaned_templates(), which hands a departing member''s templates to the longest-standing admin — an event, not a standing permission. Mirror every change in mcp_accessible_template_ids().';

-- ── mcp_accessible_template_ids — MCP ────────────────────────────────────────

create or replace function public.mcp_accessible_template_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.prompts p
  where p.workspace_id = p_workspace_id
    and (
      p.created_by = p_user_id
      or (
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
    );
$$;

comment on function public.mcp_accessible_template_ids(uuid, uuid) is
  'SQEM-292 — the MCP counterpart of can_access_template(). Both call is_named_on_template(); change one and change the other, or the channels answer differently for the same person.';
