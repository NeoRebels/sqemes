-- SQEM-149 — Connectors Phase 1a: store external MCP connectors.
--
-- First-party direction (no aggregator in the data path): a connector points at a hosted MCP
-- endpoint the workspace controls — e.g. a Shopify Storefront MCP (no auth) or a per-user endpoint
-- whose bearer is stored encrypted. OAuth-acquired tokens (Gmail/Outlook) arrive in later phases;
-- the encrypted-token column is ready for them now. Additive & non-destructive.

create table if not exists public.workspace_connectors (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  created_by           uuid references public.profiles (id) on delete set null,
  -- null = workspace-shared (admin/editor managed); set = per-user (that user's own connector/token)
  user_id              uuid references public.profiles (id) on delete cascade,
  name                 text not null,
  mcp_url              text not null,
  -- AES-GCM via _shared/crypto.ts; null = no-auth connector (e.g. Shopify Storefront). Never
  -- returned to the client — only the manage-connectors edge function (service role) decrypts it.
  auth_token_encrypted text,
  allowed_tools        text[],   -- null = all tools exposed
  created_at           timestamptz not null default now(),
  constraint workspace_connectors_https check (mcp_url like 'https://%')
);

create index if not exists workspace_connectors_workspace_idx
  on public.workspace_connectors (workspace_id);

alter table public.workspace_connectors enable row level security;

-- SELECT: members see workspace-shared connectors + their own per-user ones. The client selects
-- only metadata columns; the encrypted token is useless without the server key regardless.
drop policy if exists workspace_connectors_select on public.workspace_connectors;
create policy workspace_connectors_select on public.workspace_connectors
  for select to authenticated
  using (
    workspace_id in (select public.get_user_workspace_ids())
    and (user_id is null or user_id = (select auth.uid()))
  );

-- DELETE: a user removes their own per-user connector; admins/editors remove workspace-shared ones.
drop policy if exists workspace_connectors_delete on public.workspace_connectors;
create policy workspace_connectors_delete on public.workspace_connectors
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (user_id is null and public.get_user_role(workspace_id) in ('admin', 'editor'))
  );

-- INSERT/UPDATE intentionally have NO policy → denied for the client. Creation runs through the
-- `manage-connectors` edge function (service role) so the token is encrypted server-side, mirroring
-- how BYOK provider keys are handled by `manage-api-keys` / `workspace_api_keys`.
