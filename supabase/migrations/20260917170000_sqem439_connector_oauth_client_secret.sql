-- SQEM-439 - the secret that belongs to a hand-registered OAuth client.
--
-- SQEM-437 assumed Nifty hands out a client id you can simply paste. Their own guide says otherwise:
-- the id in the MCP settings tab is registered for CLAUDE DESKTOP's redirect URI. A third-party app
-- like ours follows the path they document for ChatGPT - you create an OAuth app in their App Center
-- against YOUR redirect URI, and that gives you a client id AND a client secret.
--
-- So a configured client can now be confidential. Nifty's own metadata allows both
-- (`token_endpoint_auth_methods_supported: ['none', 'client_secret_post']`), which is why this column
-- is nullable rather than required: a public client with PKCE stays perfectly valid.
--
-- Encrypted, like every other credential on this row - `_shared/crypto.ts`, AES-GCM, service role
-- only. A client ID next to it stays in the clear because it is not a secret (Microsoft publishes its
-- own in a 401 header); the secret is one.
alter table public.workspace_connectors add column if not exists oauth_client_secret_encrypted text;

comment on column public.workspace_connectors.oauth_client_secret_encrypted is 'SQEM-439 - AES-GCM encrypted client secret for a hand-registered OAuth client (a Nifty App Center app issues one). Null for public clients, for dynamically registered ones, and for every non-MCP connector. Read by the refresh, which has to present the same client as the original exchange.';
