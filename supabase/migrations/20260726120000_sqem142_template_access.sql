-- SQEM-142 Phase 1 — user/role-level template access (role-based v1; schema also supports
-- per-user for v2). Adds template_access + workspaces.default_template_access, a
-- SECURITY DEFINER accessor, and rewrites the prompts SELECT policy.
--
-- ADDITIVE / NON-DESTRUCTIVE: with no access rows a template is visible to everyone
-- (= current behaviour), so existing workspaces need NO backfill. Nothing changes visibly
-- until rules are created (Phase 2 UI). MCP + embedded-skill resolution run via the service
-- role and are unaffected by RLS.

-- 1. Access rows: exactly one principal per row (role XOR user_id). No rows for a template = open.
create table if not exists public.template_access (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.prompts (id) on delete cascade,
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  role          public.workspace_role,
  user_id       uuid references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  constraint template_access_one_principal
    check ((role is not null)::int + (user_id is not null)::int = 1)
);

create unique index if not exists template_access_role_uq
  on public.template_access (template_id, role) where role is not null;
create unique index if not exists template_access_user_uq
  on public.template_access (template_id, user_id) where user_id is not null;
create index if not exists template_access_template_idx  on public.template_access (template_id);
create index if not exists template_access_workspace_idx on public.template_access (workspace_id);

alter table public.template_access enable row level security;

-- Members can read the rules (editor UI); admins/editors manage them.
create policy "template_access_select" on public.template_access
  for select using (workspace_id in (select public.get_user_workspace_ids()));
create policy "template_access_insert" on public.template_access
  for insert with check (public.get_user_role(workspace_id) in ('admin', 'editor'));
create policy "template_access_delete" on public.template_access
  for delete using (public.get_user_role(workspace_id) in ('admin', 'editor'));

-- 2. Per-workspace default applied to newly-created templates (null = open). Used from Phase 2.
alter table public.workspaces add column if not exists default_template_access public.workspace_role[];

-- 3. Access check — SECURITY DEFINER so it reads template_access without RLS recursion.
--    auth.uid() still resolves to the CALLING user inside a definer function.
create or replace function public.can_access_template(
  p_template_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = (select auth.uid())
    or public.get_user_role(p_workspace_id) = 'admin'
    or not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
    or exists (
      select 1 from public.template_access ta
      where ta.template_id = p_template_id
        and (ta.role = public.get_user_role(p_workspace_id) or ta.user_id = (select auth.uid()))
    );
$$;

-- 4. Honour access rules on SELECT. insert/update/delete stay admin/editor (unchanged).
drop policy if exists "prompts_select" on public.prompts;
create policy "prompts_select" on public.prompts
  for select using (
    workspace_id in (select public.get_user_workspace_ids())
    and public.can_access_template(id, workspace_id, created_by)
  );
