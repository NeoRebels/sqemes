// SQEM-149 — connectors API. List/delete are RLS-direct on workspace_connectors; create + probe go
// through the manage-connectors edge function (token is encrypted server-side and never returned).
import { supabase } from '../supabase';

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

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

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

export async function deleteConnector(id: string): Promise<void> {
  const { error } = await client.from('workspace_connectors').delete().eq('id', id);
  if (error) throw error;
}

/** SQEM-150/153/154 — begin a one-click OAuth connector flow for an app (id from OAUTH_APPS, e.g.
 *  'google-calendar', 'microsoft-outlook'). Returns the provider consent URL to redirect to. */
export async function startOAuthConnect(workspaceId: string, app: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const res = await fetch(`${FUNCTIONS_URL}/connector-oauth-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ workspaceId, app }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error(json.error || `Error ${res.status}`);
  return json.url as string;
}
