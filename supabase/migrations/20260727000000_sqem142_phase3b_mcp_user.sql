-- SQEM-142 Phase 3b — per-user template access over MCP (OAuth connections only).
-- OAuth MCP connections are authorized by a specific user; record that user on the key row so
-- the mcp-server can filter templates by their access. API-key connections leave user_id NULL
-- and stay workspace-wide (the agreed v1 limitation). Additive & non-destructive.

alter table public.sqemes_api_keys
  add column if not exists user_id uuid references public.profiles (id) on delete set null;

-- Template ids in a workspace that a given user may access — the RLS access rules evaluated
-- for an EXPLICIT user (the mcp-server runs as the service role, so auth.uid() is null there
-- and can_access_template() can't be reused). Mirrors can_access_template()/prompts_select.
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
      (select role from r) = 'admin'
      or p.created_by = p_user_id
      or not exists (select 1 from public.template_access ta where ta.template_id = p.id)
      or exists (
        select 1 from public.template_access ta
        where ta.template_id = p.id
          and (ta.role = (select role from r) or ta.user_id = p_user_id)
      )
    );
$$;
