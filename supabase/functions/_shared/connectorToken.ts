// SQEM-150/153 — resolve a connector's usable bearer token, refreshing an expired OAuth access token
// in place (Google/Gmail + Microsoft/Outlook). Manual (1a) connectors just return their decrypted
// token. Shared by chat-message (resolveConnectors) and manage-connectors (probe).
import { encryptApiKey, decryptApiKey } from './crypto.ts';
import { MCP_OAUTH_APPS, mcpClientIdSource } from './connectorApps.ts';
import { discoverAuthServer, getOrRegisterClient } from './mcpOauth.ts';

const PUBLIC_API_URL = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
const REDIRECT_URI = `${PUBLIC_API_URL}/functions/v1/connector-oauth-callback`;

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
  /** SQEM-437 — set when the person entered a client id at connect time (Nifty). The refresh has to
   *  present the same client, and the authorization `state` that carried it is long gone by then. */
  oauth_client_id?: string | null;
  /** SQEM-439 — and its secret, when the provider issued one (Nifty App Center apps do). */
  oauth_client_secret_encrypted?: string | null;
  /** SQEM-444 — where to rediscover the token endpoint when the connector is in no registry. */
  mcp_url?: string | null;
};

// admin: a service-role client (has update rights on workspace_connectors).
export async function getFreshConnectorToken(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  row: ConnectorTokenRow,
): Promise<string | null> {
  if (!row.auth_token_encrypted) return null; // no-auth connector

  const expiresSoon = !!row.token_expires_at
    && new Date(row.token_expires_at).getTime() < Date.now() + 60_000; // 1-min skew

  /**
   * SQEM-426 — an MCP connector refreshes with a **registered** client and usually **no secret**.
   *
   * ⛔ This branch exists because the condition below demands `cfg.clientSecret`, and a public client
   * can never satisfy it. Without this, `getFreshConnectorToken` would quietly fall through to the
   * expired token and the connector would die about an hour after it was set up — with the provider's
   * 401 as the only symptom, in a place nobody connects to token refresh. That is the silent death
   * from SQEM-347, and here it would have been guaranteed rather than possible.
   *
   * ⚠️ Deliberately BEFORE the env-configured path and returning from inside: Google and Microsoft must
   * keep behaving exactly as they did. Nothing below this block changed.
   */
  if (expiresSoon && row.refresh_token_encrypted && row.provider && MCP_OAUTH_PROVIDERS.has(row.provider)) {
    const fresh = await refreshMcpOauth(admin, row);
    if (fresh) return fresh;
    // fall through to the stored token; the MCP call itself will surface the real error
  }

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

/**
 * SQEM-426 — which providers use the dynamically-registered kind. Derived from `MCP_OAUTH_APPS` so a
 * new server added to the registry refreshes without anybody remembering this file.
 */
const MCP_OAUTH_PROVIDERS = new Set([
  ...Object.values(MCP_OAUTH_APPS).map((a) => a.provider),
  // ⛔ SQEM-444 — 'mcp' is what a connector added by hand through the dialog carries. It is in no
  // registry, so without this line the refresh would fall through to the env-configured branch,
  // find no client, and the connector would die about an hour after setup with a provider 401 as
  // its only symptom. That is the SQEM-347 class, and this function has now come close to it three
  // times (SQEM-426, SQEM-430, here).
  'mcp',
]);

/** Refresh an MCP connector's access token. Returns the new token, or null to let the caller fall through. */
async function refreshMcpOauth(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  row: ConnectorTokenRow,
): Promise<string | null> {
  /**
   * SQEM-444 — a registry app when there is one, otherwise the connector's OWN url. An ad-hoc
   * connector has no entry to look up, and its `mcp_url` is the only thing that says where to
   * rediscover the token endpoint.
   */
  const app = Object.values(MCP_OAUTH_APPS).find((a) => a.provider === row.provider);
  const mcpUrl = app?.mcpUrl ?? row.mcp_url ?? '';
  if (!mcpUrl || !row.refresh_token_encrypted) return null;
  try {
    const meta = await discoverAuthServer(mcpUrl);
    // ⛔ SQEM-430 — the configured id MUST reach the refresh too. Without it a connector whose
    // client id is configured rather than registered works for exactly one hour and then dies with a
    // provider 401 as its only symptom (the SQEM-347 class).
    const client = await getOrRegisterClient(admin, meta, REDIRECT_URI, {
      ...(app ? mcpClientIdSource(app) : {}),
      // ⛔ SQEM-437 — the id this connector was actually authorized with. Falling back to the app's
      // configured one here would present a DIFFERENT client to the token endpoint, and the refresh
      // would fail with `invalid_client` for a connector that is perfectly fine.
      ...(row.oauth_client_id ? { configuredClientId: row.oauth_client_id } : {}),
      ...(row.oauth_client_secret_encrypted
        ? { configuredClientSecret: await decryptApiKey(row.oauth_client_secret_encrypted) }
        : {}),
    });
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: await decryptApiKey(row.refresh_token_encrypted),
      client_id: client.clientId,
      // ⛔ SQEM-449 — the refresh sends the same identifier as the exchange did. Left as the endpoint
      // here, a Nifty connector would work for exactly one hour: the SQEM-347 class, and the fourth
      // time this function has been within a line of it.
      resource: meta.resource ?? mcpUrl,
    });
    if (client.clientSecret) body.set('client_secret', client.clientSecret);
    const res = await fetch(meta.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tok = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok || !tok.access_token) {
      console.error('[connectorToken] MCP refresh failed', row.provider, res.status,
        (tok as { error?: string }).error ?? '(no error field)');
      return null;
    }
    const update: Record<string, unknown> = {
      auth_token_encrypted: await encryptApiKey(String(tok.access_token)),
      token_expires_at: new Date(Date.now() + ((Number(tok.expires_in) || 3600) * 1000)).toISOString(),
    };
    // ⚠️ Rotating refresh tokens are the norm for these servers — persist the new one or the NEXT
    // refresh fails with a token that was already spent.
    if (tok.refresh_token) update.refresh_token_encrypted = await encryptApiKey(String(tok.refresh_token));
    await admin.from('workspace_connectors').update(update).eq('id', row.id);
    return String(tok.access_token);
  } catch (e) {
    console.error('[connectorToken] MCP refresh threw', row.provider, e instanceof Error ? e.message : String(e));
    return null;
  }
}
