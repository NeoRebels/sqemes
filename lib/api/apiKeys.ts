import { supabase } from '../supabase';

export type ApiKeyStatus = Record<string, boolean>;

export interface AiStatus {
  keys: ApiKeyStatus;
  /** SQEM-082 — whether Sqemes-funded AI (keyless, credit-metered) is available (Cloud). */
  fundedAvailable: boolean;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function invokeFunction(functionName: string, body: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
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
