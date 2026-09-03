-- ============================================================
-- SQEM-324 — Personas: an orchestrator over existing templates
-- ============================================================
--
-- A persona is a role description plus CONDITIONS — when to load which template. The routing is
-- performed by the MCP client, lazily: the orchestrator costs a few hundred tokens and a template is
-- fetched only once its condition fires. That is the whole economic argument for the feature.
-- Putting every skill into the context up front is something anyone can do; it is only unaffordable.
--
-- ⛔ WHY THIS IS NOT A FOURTH `prompts.kind`, and why that does not contradict the unified template
-- model. The `assistants` table was removed because it DUPLICATED the template concept: same fields,
-- same lifecycle, a second name for one thing. A persona is the opposite. It has no {{variables}},
-- no context files, and no content that is ever sent as a prompt on its own — it is a COMPOSITION of
-- templates. As a fourth kind it would land in the template list, and every filter, importer,
-- exporter and marketplace path would have to learn to skip it. The cost of this decision is stated
-- rather than hidden: `pm/VISION.md` says "three kinds" in several places and has to change with it.
--
-- ⛔ WHY THE CONDITIONS LIVE IN A COLUMN AND NOT IN THE MARKDOWN. The obvious design writes the
-- routing table into the orchestrator text, which reads well and is wrong: the attachment would then
-- exist in two places. Delete a template and the prose keeps a route pointing at nothing — and
-- "Enhance with AI" will cheerfully rewrite that dead route into better prose on the next click.
-- With `persona_templates` as the single source, a dangling route is not expressible, and the
-- markdown MCP serves is COMPOSED at read time: prose from `personas.content`, table from these rows.
-- The trade accepted: the orchestrator is not one hand-editable blob. Enhance touches prose only.
--
-- ⚠️ `persona_access` SHIPS HERE ALTHOUGH ITS UI ARRIVES WITH SQEM-326. Migration history is
-- append-only in practice, so splitting one concept's schema across two migrations buys nothing and
-- costs a second review of the same shape. Until SQEM-326 no rows are written, and no rows means
-- open to the workspace — exactly the state templates are in before somebody restricts one.
--
-- ⚠️ AND IT HAS NO `role` COLUMN, deliberately. `template_access` still carries one because rows
-- written before SQEM-211 have to keep resolving; nothing has written a role row since. A new table
-- inheriting a deprecated principal would import the bug with the feature — `is_named_on_template`
-- needs `p_workspace_id` purely to resolve those legacy rows, which is why the persona twin below
-- does not take one.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.personas (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces on delete cascade,
  title           text not null,
  description     text not null default '',
  -- The orchestrator PROSE only: role, working style, rules. Never the routing table (see above).
  content         text not null default '',
  tags            text[] not null default '{}',
  created_by      uuid references public.profiles on delete set null,
  -- SQEM-265 / EU AI Act Art. 50(2) — set when the wizard generated this. NULL means "not known to
  -- be generated", never "written by a person"; it is not backfilled, because nothing in an old row
  -- can tell us which it was.
  ai_generated_at timestamptz,
  usage_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists personas_workspace_idx on public.personas (workspace_id);

-- One route: this template, under this condition. `condition` is prose the model evaluates ("the
-- user wants an offer laid out"), not something we parse — we never branch on it, which is what
-- keeps a persona a document rather than the prompt chain the guardrails removed.
create table if not exists public.persona_templates (
  persona_id  uuid not null references public.personas on delete cascade,
  template_id uuid not null references public.prompts  on delete cascade,
  condition   text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (persona_id, template_id)
);

create index if not exists persona_templates_template_idx on public.persona_templates (template_id);

-- ⚠️ `on delete cascade` on `template_id`, not `set null`: a route to a deleted template is not a
-- route with a hole in it, it is not a route. The alternative leaves the orchestrator advertising
-- something no client can fetch, which is the failure this feature exists to avoid.

create table if not exists public.persona_access (
  id           uuid primary key default gen_random_uuid(),
  persona_id   uuid not null references public.personas on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id      uuid references public.profiles on delete cascade,
  group_id     uuid references public.workspace_groups on delete cascade,
  created_by   uuid references public.profiles on delete set null,
  created_at   timestamptz not null default now(),
  -- At most one principal. A row naming NEITHER is the "only me" marker — the same three-state model
  -- as templates (SQEM-210): no rows = everyone · one principal-less row = the creator alone ·
  -- rows naming principals = restricted.
  constraint persona_access_one_principal
    check ((user_id is not null)::int + (group_id is not null)::int <= 1)
);

create unique index if not exists persona_access_user_uq
  on public.persona_access (persona_id, user_id) where user_id is not null;
create unique index if not exists persona_access_group_uq
  on public.persona_access (persona_id, group_id) where group_id is not null;
create unique index if not exists persona_access_private_uq
  on public.persona_access (persona_id) where user_id is null and group_id is null;

-- ── Access functions ─────────────────────────────────────────────────────────
--
-- Faithful mirrors of the template trio (SQEM-292). ⛔ THE TWO PUBLIC ONES MUST AGREE: RLS answers
-- the app and Chat, `mcp_accessible_persona_ids()` answers MCP. When they drift nothing fails — one
-- channel simply shows a persona the other hides, and nobody finds out from an error message.

create or replace function public.is_named_on_persona(
  p_persona_id uuid, p_user_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.persona_access pa
    where pa.persona_id = p_persona_id
      and (
        pa.user_id = p_user_id
        or pa.group_id in (
          select gm.group_id from public.workspace_group_members gm where gm.user_id = p_user_id
        )
      )
  );
$$;

comment on function public.is_named_on_persona(uuid, uuid) is
  'SQEM-324 — is this person named on the persona, directly or through a group? No role principal: nothing has written role rows since SQEM-211, and a new table does not inherit a deprecated one.';

create or replace function public.can_access_persona(
  p_persona_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = (select auth.uid())
    or (
      not exists (
        select 1 from public.persona_access pa
        where pa.persona_id = p_persona_id
          and pa.user_id is null and pa.group_id is null
      )
      and (
        not exists (select 1 from public.persona_access pa where pa.persona_id = p_persona_id)
        or public.is_named_on_persona(p_persona_id, (select auth.uid()))
      )
    );
$$;

comment on function public.can_access_persona(uuid, uuid) is
  'SQEM-324 — the creator, or whoever is named. Admins and editors get no automatic access, matching what SQEM-292 settled for templates: "Restrict access" has to mean what it says. Mirror every change in mcp_accessible_persona_ids().';

create or replace function public.mcp_accessible_persona_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.personas p
  where p.workspace_id = p_workspace_id
    and (
      p.created_by = p_user_id
      or (
        not exists (
          select 1 from public.persona_access pa
          where pa.persona_id = p.id and pa.user_id is null and pa.group_id is null
        )
        and (
          not exists (select 1 from public.persona_access pa where pa.persona_id = p.id)
          or public.is_named_on_persona(p.id, p_user_id)
        )
      )
    );
$$;

comment on function public.mcp_accessible_persona_ids(uuid, uuid) is
  'SQEM-324 — the MCP counterpart of can_access_persona(). Both call is_named_on_persona(); change one and change the other, or the channels answer differently for the same person.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Read follows access; write stays admin/editor, exactly as `prompts` does. A persona is workspace
-- knowledge, not personal notes.

alter table public.personas          enable row level security;
alter table public.persona_templates enable row level security;
alter table public.persona_access    enable row level security;

create policy "personas_select" on public.personas
  for select to authenticated
  using (
    workspace_id in (select public.get_user_workspace_ids())
    and public.can_access_persona(id, created_by)
  );

create policy "personas_insert" on public.personas
  for insert to authenticated
  with check (public.get_user_role(workspace_id) in ('admin', 'editor'));

create policy "personas_update" on public.personas
  for update to authenticated
  using (public.get_user_role(workspace_id) in ('admin', 'editor'));

create policy "personas_delete" on public.personas
  for delete to authenticated
  using (public.get_user_role(workspace_id) in ('admin', 'editor'));

-- The routes of a persona you cannot see are not yours to read. Written through the parent rather
-- than duplicating the access test, so there is one definition of "may see this persona".
create policy "persona_templates_select" on public.persona_templates
  for select to authenticated
  using (
    exists (
      select 1 from public.personas p
      where p.id = persona_templates.persona_id
        and p.workspace_id in (select public.get_user_workspace_ids())
        and public.can_access_persona(p.id, p.created_by)
    )
  );

create policy "persona_templates_write" on public.persona_templates
  for all to authenticated
  using (
    exists (
      select 1 from public.personas p
      where p.id = persona_templates.persona_id
        and public.get_user_role(p.workspace_id) in ('admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.personas p
      where p.id = persona_templates.persona_id
        and public.get_user_role(p.workspace_id) in ('admin', 'editor')
    )
  );

create policy "persona_access_select" on public.persona_access
  for select to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

create policy "persona_access_insert" on public.persona_access
  for insert to authenticated
  with check (public.get_user_role(workspace_id) in ('admin', 'editor'));

create policy "persona_access_delete" on public.persona_access
  for delete to authenticated
  using (public.get_user_role(workspace_id) in ('admin', 'editor'));

comment on table public.personas is
  'SQEM-324 — an orchestrator over templates: prose in `content`, routes in `persona_templates`. MCP-only; there is no Chat launch path, and that gap is argued in pm/VISION.md rather than left to look accidental.';
comment on table public.persona_templates is
  'SQEM-324 — one route: template + the condition under which a client should load it. `condition` is prose for the model, never parsed here — parsing it would turn a document into the prompt chain the guardrails removed.';
comment on table public.persona_access is
  'SQEM-324 — the template_access model minus the legacy role principal. No rows = everyone; one principal-less row = only the creator; rows naming principals = restricted. UI arrives with SQEM-326.';
