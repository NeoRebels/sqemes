import { supabase } from '../supabase';
import { FUNCTIONS_BASE } from '../env';

export type ApiKeyStatus = Record<string, boolean>;

export interface AiStatus {
  keys: ApiKeyStatus;
  /** SQEM-082 — whether Sqemes-funded AI (keyless, credit-metered) is available (Cloud). */
  fundedAvailable: boolean;
}


async function invokeFunction(functionName: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_BASE}/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,

    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Edge function returned ${res.status}`);
  }

  return res.json();
}

export async function getApiKeyStatus(workspaceId: string): Promise<AiStatus> {
  const data = await invokeFunction('manage-api-keys', { workspaceId });
  return { keys: data?.keys || {}, fundedAvailable: !!data?.fundedAvailable };
}

export async function saveApiKey(workspaceId: string, provider: string, key: string) {
  return invokeFunction('manage-api-keys', { workspaceId, provider, key });
}

export async function deleteApiKey(workspaceId: string, provider: string) {
  return invokeFunction('manage-api-keys', { workspaceId, provider, action: 'delete' });
}

/**
 * SQEM-425 — has any MCP client actually connected to this workspace?
 *
 * Every MCP call authenticates against `sqemes_api_keys` and the server stamps `last_used_at` on the
 * key it used (`mcp-server/index.ts`), OAuth connections included — they are rows in the same table
 * (`is_oauth`). So one row with a non-null `last_used_at` is **evidence**, not a guess: a tool has
 * spoken to this workspace at least once. A key that was issued and never used stays null.
 *
 * ⚠️ Deliberately fails to `false`. RLS shows the caller only the keys they may see (their own; an
 * admin more), and the wizard is not admin-only — so a member can legitimately get nothing back.
 * Unknown must render as "not confirmed", never as a check mark that was never earned.
 */
export async function hasUsedMcpConnection(workspaceId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('sqemes_api_keys')
      .select('id')
      .eq('workspace_id', workspaceId)
      .not('last_used_at', 'is', null)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}
