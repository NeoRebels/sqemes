-- SQEM-065 — MCP OAuth refresh tokens (two-tier expiry).
-- The OAuth access token (a sqemes_api_keys row) becomes short-lived; a refresh
-- token carries the user-chosen connection lifetime and rotates the access token.
-- Additive; mcp-server is unchanged (still checks sqemes_api_keys.expires_at).

-- For OAuth connections, sqemes_api_keys.expires_at now holds the SHORT access-token
-- TTL (what mcp-server enforces). connection_expires_at holds the displayed
-- connection lifetime for the Integrations tab. NULL for manual keys (which display
-- expires_at directly) and for "Never" connections.
ALTER TABLE public.sqemes_api_keys
  ADD COLUMN IF NOT EXISTS connection_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_oauth              boolean NOT NULL DEFAULT false;

-- Refresh tokens — one per OAuth connection, FK to the connection's key row so
-- deleting the connection (Integrations tab) revokes it via cascade.
CREATE TABLE IF NOT EXISTS public.mcp_refresh_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text        NOT NULL UNIQUE,
  key_id       uuid        NOT NULL REFERENCES public.sqemes_api_keys(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scopes       text[]      NOT NULL,
  expires_at   timestamptz,            -- connection lifetime; NULL = never
  revoked      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_refresh_tokens_key_id_idx ON public.mcp_refresh_tokens (key_id);

-- Only the mcp-oauth edge function (service role) touches this table; deny everyone else.
ALTER TABLE public.mcp_refresh_tokens ENABLE ROW LEVEL SECURITY;
