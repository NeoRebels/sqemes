// SQEM-150/153 — resolve a connector's usable bearer token, refreshing an expired OAuth access token
// in place (Google/Gmail + Microsoft/Outlook). Manual (1a) connectors just return their decrypted
// token. Shared by chat-message (resolveConnectors) and manage-connectors (probe).
import { encryptApiKey, decryptApiKey } from './crypto.ts';

// Per-provider refresh config. Microsoft's endpoint covers work/school + personal (common tenant).
const REFRESH: Record<string, { url: string; clientId: string; clientSecret: string }> = {
  google: {
    url: 'https://oauth2.googleapis.com/token',
    clientId: Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '',
  },
  microsoft: {
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: Deno.env.get('MICROSOFT_OAUTH_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('MICROSOFT_OAUTH_CLIENT_SECRET') ?? '',
  },
};

export type ConnectorTokenRow = {
  id: string;
  provider?: string | null;
  auth_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: string | null;
};

// admin: a service-role client (has update rights on workspace_connectors).
export async function getFreshConnectorToken(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  row: ConnectorTokenRow,
): Promise<string | null> {
  if (!row.auth_token_encrypted) return null; // no-auth connector

  const expiresSoon = !!row.token_expires_at
    && new Date(row.token_expires_at).getTime() < Date.now() + 60_000; // 1-min skew
  const cfg = row.provider ? REFRESH[row.provider] : undefined;

  if (cfg && expiresSoon && row.refresh_token_encrypted && cfg.clientId && cfg.clientSecret) {
    try {
      const refreshToken = await decryptApiKey(row.refresh_token_encrypted);
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const tok = await res.json();
      if (res.ok && tok.access_token) {
        const newExpiry = new Date(Date.now() + ((tok.expires_in ?? 3600) * 1000)).toISOString();
        const update: Record<string, unknown> = {
          auth_token_encrypted: await encryptApiKey(tok.access_token),
          token_expires_at: newExpiry,
        };
        // Microsoft rotates refresh tokens on use — persist the new one so the next refresh works.
        if (tok.refresh_token) update.refresh_token_encrypted = await encryptApiKey(tok.refresh_token);
        await admin.from('workspace_connectors').update(update).eq('id', row.id);
        return tok.access_token;
      }
      // refresh failed — fall through to the (stale) stored token; the provider call surfaces the error
    } catch { /* fall through */ }
  }

  return await decryptApiKey(row.auth_token_encrypted);
}
