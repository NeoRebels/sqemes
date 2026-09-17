-- SQEM-440 - Notion moves to its own MCP server; the `mcp-notion` shim is gone.
--
-- Until now a Notion connector pointed at OUR REST shim and carried a pasted internal-integration
-- token. Notion runs its own MCP server with dynamic client registration (measured 2026-09-17:
-- `https://mcp.notion.com/register` exists), so the connector becomes an ordinary redirect like
-- Plaud's - nothing to create at notion.so, nothing to paste.
--
-- ==========================================================================================
-- This DELETES connector rows, so read the WHERE clause before changing anything.
--
-- The rows cannot survive: they point at a function that no longer exists, and they hold a Notion
-- token rather than an OAuth one. Leaving them would give people a connector that looks connected and
-- fails on every call. The owner chose removal over keeping the shim alive (2026-09-17, option "a"),
-- so the tile shows "not connected" and one click reconnects properly.
--
-- ⛔ The clause is deliberately NARROW: provider = 'notion' AND the URL is our shim. A connector
-- somebody added by hand against a different Notion endpoint is not ours to delete, and neither is
-- anything a future Notion entry creates - those carry `https://mcp.notion.com/mcp`.
--
-- It reports the count, because this is user data and a silent delete is not something to find out
-- about later. The deploy log only ever says "Remote database is up to date"; the notice shows in the
-- Supabase dashboard for the run.
-- ==========================================================================================
do $$
declare
  removed integer;
begin
  delete from public.workspace_connectors
  where provider = 'notion'
    and mcp_url like '%/functions/v1/mcp-notion%';
  get diagnostics removed = row_count;
  raise notice 'SQEM-440: removed % shim-based Notion connector(s); they need reconnecting', removed;
end $$;
