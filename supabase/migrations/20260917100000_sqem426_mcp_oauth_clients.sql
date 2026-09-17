-- SQEM-426 - remember the OAuth client we registered at a third-party MCP server.
--
-- Why a table at all: Google and Microsoft gave us a client id and secret by hand, once, and they live
-- in env vars. An MCP server that supports dynamic client registration (RFC 7591) hands one out on
-- request - but only when asked, and the id that comes back must survive until the user returns from
-- the consent screen, because the token exchange has to present the SAME client. Env vars cannot hold
-- something created at runtime, so it goes here.
--
-- One row per authorization server, not per user and not per workspace. A client registration
-- identifies THIS INSTANCE to the other side, exactly like the Google client id does. Registering one
-- per user would create thousands of clients at somebody elses service and would not make anything
-- safer: what separates two users is their own token, which lives per connector in
-- workspace_connectors.
--
-- No RLS policy, on purpose. RLS is enabled and nothing is granted, so only the service role reaches
-- this table - the same posture as any other credential store here. There is no legitimate browser
-- read: the client id is used by edge functions when building the consent URL, never by the app, and a
-- client secret (when the server issues one) must never leave the server at all.
--
-- ==========================================================================================
-- STOP - read this before editing. It cost two red preview checks on 2026-09-17, and the honest state
-- of knowledge is: WE DO NOT KNOW EXACTLY WHY.
--
-- What happened: the Supabase preview check rejected this migration with
--   ERROR: column "redirect_uri" of relation "public.mcp_oauth_clients" does not exist
--   At statement: 3
-- pointing at a COMMENT ON COLUMN for a column created in statement 1. Two theories were tested and
-- both were wrong: splitting comment strings across lines (rewritten to one line - still failed), and
-- apostrophes inside line comments confusing the statement scanner (49 of the other 120 migrations
-- carry those and apply fine, so that model does not hold either).
--
-- What the file does instead of relying on a theory: it REPAIRS. Every column is created in the table
-- and then added again defensively, the unique index is created separately rather than as a table
-- constraint, and nothing assumes a clean slate. A preview branch that kept a half-built table from an
-- earlier attempt is brought to the same end state as an empty one.
--
-- If this fails again, the next step is not another guess: read the actual table on the preview branch
-- (Supabase dashboard, the project ref in the failing check) and compare it with the definition below.
-- ==========================================================================================
create table if not exists public.mcp_oauth_clients (
  id                      uuid primary key default gen_random_uuid(),
  -- The issuer as the authorization server reports it in its metadata. The lookup key.
  issuer                  text        not null,
  client_id               text        not null,
  -- Present only when the server issues one. A public client (PKCE, token_endpoint_auth_method none)
  -- has no secret, and that is the normal case for MCP servers.
  client_secret_encrypted text,
  -- What we registered with, so a changed redirect URI can be detected rather than guessed at.
  redirect_uri            text,
  -- The raw registration response, for diagnosing a rejection months later without re-registering.
  registration            jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Repair pass: a partial table from the broken first run gets its missing columns here.
alter table public.mcp_oauth_clients add column if not exists issuer                  text;
alter table public.mcp_oauth_clients add column if not exists client_id               text;
alter table public.mcp_oauth_clients add column if not exists client_secret_encrypted text;
alter table public.mcp_oauth_clients add column if not exists redirect_uri            text;
alter table public.mcp_oauth_clients add column if not exists registration            jsonb;
alter table public.mcp_oauth_clients add column if not exists created_at              timestamptz not null default now();
alter table public.mcp_oauth_clients add column if not exists updated_at              timestamptz not null default now();

-- The uniqueness the upsert in _shared/mcpOauth.ts conflicts on. As an index, so a repaired table
-- gets it too (a column added later carries no table-level constraint).
create unique index if not exists mcp_oauth_clients_issuer_key on public.mcp_oauth_clients (issuer);

alter table public.mcp_oauth_clients enable row level security;

comment on table public.mcp_oauth_clients is 'SQEM-426 - OAuth clients dynamically registered at third-party MCP servers (RFC 7591). One row per authorization server issuer; service-role only. The per-user access token lives in workspace_connectors.';

comment on column public.mcp_oauth_clients.redirect_uri is 'The redirect URI sent at registration. If PUBLIC_API_URL changes this no longer matches what the callback uses and the provider rejects the exchange - compare that before blaming the token endpoint.';
