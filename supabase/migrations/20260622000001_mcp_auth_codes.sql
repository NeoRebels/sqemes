-- SQEM-048 — MCP OAuth auth codes
-- Short-lived codes exchanged for sqm_live_ API keys via PKCE flow.
-- Only accessed by the mcp-oauth edge function via the service role.

CREATE TABLE public.mcp_auth_codes (
  code                  text        PRIMARY KEY,
  workspace_id          uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id               uuid        NOT NULL,
  code_challenge        text        NOT NULL,
  code_challenge_method text        NOT NULL DEFAULT 'S256',
  redirect_uri          text        NOT NULL,
  state                 text,
  client_id             text,
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  used                  boolean     NOT NULL DEFAULT false
);

CREATE INDEX ON public.mcp_auth_codes (expires_at);
