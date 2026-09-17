-- SQEM-437 - remember the OAuth client id a PERSON entered when they connected.
--
-- Three shapes of MCP OAuth exist by now, and they differ only in where the client id comes from:
-- registered on request (Plaud, Notion - RFC 7591), advertised by the server in its own 401 header
-- (Microsoft), or entered by the person connecting (Nifty, one per user from their MCP settings).
--
-- The first two need no storage: one lives in `mcp_oauth_clients`, the other is re-read from the
-- header every time. The third has nowhere else to live.
--
-- ==========================================================================================
-- Why a column and not just the `state`: the value has to survive THREE moments, and the third is
-- the one that breaks quietly.
--
--   1. the redirect to the provider  - the encrypted `state` carries it
--   2. the token exchange            - read back out of that `state`
--   3. the refresh, an hour later    - the `state` is long gone
--
-- Without (3) the connector works for exactly one hour and then dies with a provider 401 as its only
-- symptom. That is the SQEM-347 class, and the same refresh path has now come close to it twice
-- (SQEM-426, SQEM-430).
-- ==========================================================================================
alter table public.workspace_connectors add column if not exists oauth_client_id text;

comment on column public.workspace_connectors.oauth_client_id is 'SQEM-437 - the OAuth client id entered by the person who connected (Nifty issues one per user). Null for every other kind: registered clients live in mcp_oauth_clients, advertised ones are re-read from the servers WWW-Authenticate header. Needed by the refresh, where the authorization state no longer exists.';

-- ⚠️ No GRANT, deliberately. A client id is not a secret - Microsoft publishes its own in a 401
-- header - but `workspace_connectors` is written by edge functions under the service role only
-- (SQEM-149), and carving out one client-writable column would be a new rule to explain for no gain.
