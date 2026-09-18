// SQEM-149 — connectors API. List/delete are RLS-direct on workspace_connectors; create + probe go
// through the manage-connectors edge function (token is encrypted server-side and never returned).
import { supabase } from '../supabase';
import { FUNCTIONS_BASE } from '../env';

// workspace_connectors is not in the generated database.types yet (added by migration 20260727120000);
// a thin cast keeps this typed at the call sites without regenerating.
type ConnectorsClient = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const client = supabase as unknown as ConnectorsClient;

export type Connector = {
  id: string;
  name: string;
  mcp_url: string;
  user_id: string | null; // null = workspace-shared; set = per-user
  allowed_tools: string[] | null;
  provider: string | null; // 'manual' (1a) | 'google' (Gmail, SQEM-150) — drives the OAuth-apps UI
  created_at: string;
};

export type ConnectorTool = { name: string; description?: string };
export type ProbeResult = { ok: boolean; serverName?: string; tools?: ConnectorTool[]; error?: string };

/**
 * ⚠️ **The trailing slash is stripped, and that is not tidiness.** The edge functions normalise their
 * own base the same way (`.trim().replace(/\/+$/, '')` in `connector-oauth-start` and
 * `_shared/connectorApps.ts`). This side did not — and the two then disagreed: staging's
 * `VITE_SUPABASE_URL` carries a trailing slash, so `connectorRedirectUri()` handed out
 * `…supabase.co//functions/v1/connector-oauth-callback` while the server sent the single-slash form.
 * Somebody registered the double-slash version at Nifty and got *"this connection request is invalid
 * or expired"* — an error that names neither the URI nor the slash.
 *
 * ⭐ **SQEM-456 moved the rule where it can be reached.** This module held the only correct copy, and
 * nineteen other call sites went on appending to the raw variable — because importing a URL rule from
 * an API module is not something anybody thinks to do. The normalisation now lives in `lib/env.ts`
 * and this file uses it like everyone else. The note above stays: it is the evidence.
 */
const FUNCTIONS_URL = FUNCTIONS_BASE;

/**
 * SQEM-439 — the redirect URI a third-party OAuth app has to be registered with.
 *
 * ⛔ Some providers (Nifty) do not hand out a client; you register one in THEIR developer area against
 * a redirect URI, and the client only works for that URI. The person connecting cannot know ours, and
 * the failure if they guess is a token-endpoint error that names everything except the URI — so the
 * dialog has to show it.
 *
 * ⚠️ It differs per environment (`VITE_SUPABASE_URL`), so a staging app and a production app are two
 * different registrations. The dialog says so.
 *
 * ⛔ It must be **byte-identical** to what `connector-oauth-start` sends — the provider compares
 * exactly. Two places computing one URL is the shape of this bug; the normalisation both sides share
 * now lives in `lib/env.ts` (`SUPABASE_BASE`), see the note on `FUNCTIONS_URL` above.
 */
export function connectorRedirectUri(): string {
  return `${FUNCTIONS_URL}/connector-oauth-callback`;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_URL}/manage-connectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json as T;
}

/** Connectors visible to the caller (workspace-shared + their own per-user), metadata only. */
export async function fetchConnectors(workspaceId: string): Promise<Connector[]> {
  const { data, error } = await client
    .from('workspace_connectors')
    .select('id, name, mcp_url, user_id, allowed_tools, provider, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Connector[];
}

/** Handshake a connector (unsaved url+token, or an existing connectorId) and list its tools. */
export function probeConnector(
  input: { mcpUrl: string; token?: string } | { connectorId: string },
): Promise<ProbeResult> {
  return invoke<ProbeResult>({ action: 'probe', ...input });
}

/**
 * SQEM-438 — which of a connector's tools may be used.
 *
 * ⛔ An edge function, not a table update: `workspace_connectors` has no UPDATE policy on purpose
 * (SQEM-149), so the browser cannot write this row at all.
 *
 * ⚠️ `null` means "no restriction" and is NOT the same as listing every tool — with no restriction
 * the provider's future tools are included automatically, with a list the set is frozen.
 */
/**
 * SQEM-444 — what kind of MCP server is this?
 *
 * The dialog used to make the person choose between "paste a token" and "no auth", which are two of
 * four shapes and not the ones most servers use. The server's own answer decides, so this asks it.
 */
export type InspectResult =
  | { ok: true; kind: 'none'; serverName?: string; tools?: ConnectorTool[] }
  | { ok: true; kind: 'oauth'; issuer: string; registration: boolean; scopes: string[] }
  | { ok: true; kind: 'token'; reason?: string };

export function inspectConnector(mcpUrl: string): Promise<InspectResult> {
  return invoke<InspectResult>({ action: 'inspect', mcpUrl });
}

export function setConnectorTools(connectorId: string, tools: string[] | null): Promise<{ ok: boolean; allowedTools: string[] | null }> {
  return invoke({ action: 'set-tools', connectorId, tools });
}

export function createConnector(input: {
  workspaceId: string;
  name: string;
  mcpUrl: string;
  token?: string;
  shared: boolean;
  allowedTools?: string[];
}): Promise<{ ok: boolean; connector: Connector }> {
  return invoke({ action: 'create', ...input });
}

/** SQEM-157/159 — create a token-paste connector (app = 'shopify' | 'github'). `shop` only
 *  applies to Shopify. No OAuth — the pasted token is encrypted server-side. */
export function createTokenConnector(input: {
  workspaceId: string; app: string; token: string; shared: boolean; shop?: string;
}): Promise<{ ok: boolean; connector: Connector }> {
  return invoke({ action: 'create-token', ...input });
}

export async function deleteConnector(id: string): Promise<void> {
  const { error } = await client.from('workspace_connectors').delete().eq('id', id);
  if (error) throw error;
}

/** SQEM-150/153/154 — begin a one-click OAuth connector flow for an app (id from OAUTH_APPS, e.g.
 *  'google-calendar', 'microsoft-outlook'). Returns the provider consent URL to redirect to.
 *
 *  SQEM-437 — `clientId` is for MCP servers that neither register a client on request nor advertise
 *  one, and expect a value the PERSON holds (Nifty issues one per user). Omitted for every other app. */
export async function startOAuthConnect(
  workspaceId: string,
  app: string,
  clientId?: string,
  clientSecret?: string,
  /** SQEM-444 — an MCP server that is in no registry: its URL and name travel instead of an app id. */
  adHoc?: { mcpUrl: string; name: string; scopes?: string[] },
): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_URL}/connector-oauth-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ workspaceId, app, ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}), ...(adHoc ?? {}) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error(json.error || `Error ${res.status}`);
  return json.url as string;
}
