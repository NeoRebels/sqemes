-- SQEM-019 — Security hardening (RLS / privilege fixes surfaced by the review)
--
-- Three server-side isolation fixes, all exploitable through the public PostgREST API.
-- Legit flows are unaffected: workspace joins go through SECURITY DEFINER functions
-- (accept_invitation / handle_new_user / create_workspace) which bypass RLS, the client
-- never inserts into workspace_members directly, and increment_credits is only ever
-- called by edge functions via the service role.

-- ── CRITICAL 1 — workspace_members self-admin takeover ────────────────────────
-- The old INSERT policy allowed `user_id = auth.uid()`, so any authenticated user could
-- POST { workspace_id: <any>, user_id: <self>, role: 'admin' } and become admin of any
-- workspace. Drop the unconstrained self-insert branch; only an existing admin of the
-- workspace may insert membership rows (no self-escalation possible).
DROP POLICY IF EXISTS workspace_members_insert ON public.workspace_members;
CREATE POLICY workspace_members_insert ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role(workspace_id) = 'admin'::workspace_role);

-- ── CRITICAL 2 — mcp_auth_codes had RLS disabled ─────────────────────────────
-- The table was created without RLS ("only accessed by the service role" — but a public
-- table without RLS is fully read/writable via PostgREST). An attacker could INSERT a
-- forged auth code for a victim workspace with a self-owned PKCE challenge and redeem it
-- for a victim-scoped MCP token. Enable RLS with no policies: authenticated/anon are
-- denied; the mcp-oauth edge function (service role) bypasses RLS and keeps working.
ALTER TABLE public.mcp_auth_codes ENABLE ROW LEVEL SECURITY;

-- ── HIGH — increment_credits callable by anyone ──────────────────────────────
-- SECURITY DEFINER with no membership check and default PUBLIC execute. A user could call
-- it as an RPC with a negative amount (unlimited free funded AI) or a positive amount
-- against a victim workspace (credit griefing). Restrict execution to the service role.
REVOKE EXECUTE ON FUNCTION public.increment_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_credits(uuid, integer) TO service_role;
