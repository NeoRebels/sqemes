-- SQEM-068 — store the connection name chosen on the OAuth consent screen,
-- carried via the auth code to the issued sqemes_api_keys row.
ALTER TABLE public.mcp_auth_codes
  ADD COLUMN IF NOT EXISTS name text;
