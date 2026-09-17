// SQEM-150/153/154 — begin a one-click OAuth-connector flow for an "app" (Gmail, Google Calendar/
// Docs/Sheets/Drive, Outlook, …). Authenticated: returns the provider consent URL carrying an encrypted
// `state` ({workspaceId, userId, app, exp}) so the public callback can trust who is connecting.
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey } from '../_shared/crypto.ts';
import { CONNECTOR_APPS, MCP_OAUTH_APPS, PROVIDERS, mcpClientIdSource } from '../_shared/connectorApps.ts';
import { discoverAuthServer, getOrRegisterClient, createPkce } from '../_shared/mcpOauth.ts';

const PUBLIC_API_URL = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
const REDIRECT_URI = `${PUBLIC_API_URL}/functions/v1/connector-oauth-callback`;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const {
      workspaceId, app: appId = 'google-gmail',
      clientId: enteredClientId, clientSecret: enteredClientSecret,
      mcpUrl: adHocUrl, name: adHocName, scopes: adHocScopes,
    } = await req.json().catch(() => ({}));
    // SQEM-426 — two kinds of app reach this function now. The MCP kind has no provider config and no
    // client of its own until we register one, so it is decided BEFORE the env lookup below.
    const mcpApp = MCP_OAUTH_APPS[appId as string];

    /**
     * SQEM-444 — the same flow for a server nobody put in the registry.
     *
     * Everything SQEM-426/429/430/437/439 built was reachable only through a tile we had shipped. The
     * mechanics were general; the way in was not. An ad-hoc target is just a name and a URL, and from
     * here on it travels the identical path.
     *
     * ⚠️ Validated the way the Shopify Storefront tile validates its host (SQEM-441): https only, a
     * hostname rather than an IP. Our own function fetches this URL during discovery, so it is not a
     * free-form field — it is the same surface the manual connector has offered since SQEM-149, no
     * wider.
     */
    const adHoc = typeof adHocUrl === 'string' && adHocUrl.trim() ? adHocUrl.trim() : '';
    if (adHoc) {
      let u: URL | null = null;
      try { u = new URL(adHoc); } catch { u = null; }
      const bad = !u || u.protocol !== 'https:' || /^\d+(\.\d+){3}$/.test(u.hostname) || !u.hostname.includes('.');
      if (bad) return json({ error: 'mcpUrl must be an https:// address with a hostname' }, 400);
    }
    const mcpTarget = mcpApp ?? (adHoc
      ? {
          provider: 'mcp',
          name: (typeof adHocName === 'string' && adHocName.trim()) || new URL(adHoc).hostname,
          mcpUrl: adHoc,
          scopes: Array.isArray(adHocScopes) ? adHocScopes.map(String) : undefined,
        }
      : undefined);
    const app = CONNECTOR_APPS[appId as string];
    if (!app && !mcpTarget) return json({ error: 'Unsupported app' }, 400);
    const cfg = app ? PROVIDERS[app.provider] : undefined;
    // SQEM-273 — trimmed for the same reason as the callback: a pasted value with trailing
    // whitespace would send a client_id the provider does not recognise, and nothing would say so.
    const clientId = cfg ? (Deno.env.get(cfg.clientIdEnv) ?? '').trim() : '';
    if (cfg && !clientId) return json({ error: `This connector is not configured on this instance (${cfg.clientIdEnv}).` }, 503);
    if (!workspaceId) return json({ error: 'workspaceId required' }, 400);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: mem } = await admin.from('workspace_members').select('role')
      .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
    if (!mem) return json({ error: 'Not a member of this workspace' }, 403);

    // ---- SQEM-426: the MCP kind discovers, registers, and carries PKCE through `state` ----
    if (mcpTarget) {
      const meta = await discoverAuthServer(mcpTarget.mcpUrl);
      /**
       * SQEM-437 — a client id the PERSON entered outranks everything else, for the same reason a
       * configured one does in `getOrRegisterClient`: it was chosen deliberately. Trimmed, because a
       * pasted value with trailing whitespace produces a client_id the provider does not recognise
       * and nothing here would say so (SQEM-273).
       */
      const entered = typeof enteredClientId === 'string' ? enteredClientId.trim() : '';
      const enteredSecret = typeof enteredClientSecret === 'string' ? enteredClientSecret.trim() : '';
      const client = await getOrRegisterClient(admin, meta, REDIRECT_URI, {
        ...(mcpApp ? mcpClientIdSource(mcpApp) : {}),
        ...(entered ? { configuredClientId: entered } : {}),
        ...(enteredSecret ? { configuredClientSecret: enteredSecret } : {}),
      });
      const { verifier, challenge } = await createPkce();
      /**
       * ⚠️ The verifier travels inside the SAME encrypted `state` the callback already decrypts. It
       * must not be stored anywhere else: a verifier in a table would outlive the flow, and a verifier
       * in a cookie would not survive the provider's redirect. `state` is exactly as long-lived as the
       * exchange it belongs to, and it is already encrypted and time-boxed.
       */
      const mcpState = await encryptApiKey(JSON.stringify({
        w: workspaceId, u: user.id, a: appId, k: 'mcp', v: verifier, i: meta.issuer,
        // SQEM-437 — `c` rides along so the callback can present the SAME client at the token
        // endpoint and then persist it for the refresh.
        ...(entered ? { c: entered } : {}),
        // ⚠️ SQEM-439 — the secret rides the SAME encrypted, time-boxed `state` as the PKCE verifier.
        // It is AES-encrypted and expires in ten minutes, but the ciphertext does travel in a URL and
        // therefore into the provider's logs. The alternative — a half-built row written before the
        // redirect — puts an incomplete connection in the table that something then has to clean up.
        // This is the lesser of the two; it is a trade-off, not a free choice.
        ...(enteredSecret ? { s: enteredSecret } : {}),
        // SQEM-444 — an ad-hoc target has no registry entry, so its name and URL ride along.
        ...(mcpApp ? {} : { m: mcpTarget.mcpUrl, n: mcpTarget.name }),
        exp: Math.floor(Date.now() / 1000) + 600,
      }));
      const authUrl = new URL(meta.authorization_endpoint);
      authUrl.searchParams.set('client_id', client.clientId);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', mcpState);
      // ⚠️ `resource` (RFC 8707) tells the server which MCP endpoint the token is for. Servers that
      // ignore it are unaffected; servers that audience-bind their tokens refuse without it.
      // ⛔ SQEM-449 — the identifier the server declares, not the endpoint we happen to call. Sending
      // the endpoint gets `invalid_target: unknown resource` wherever the two differ.
      authUrl.searchParams.set('resource', meta.resource ?? mcpTarget.mcpUrl);
      if (mcpTarget.scopes?.length) authUrl.searchParams.set('scope', mcpTarget.scopes.join(' '));
      return json({ url: authUrl.toString() });
    }

    const state = await encryptApiKey(JSON.stringify({ w: workspaceId, u: user.id, a: appId, exp: Math.floor(Date.now() / 1000) + 600 }));
    const url = new URL(cfg!.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', app!.scopes.join(' '));
    url.searchParams.set('state', state);
    for (const [k, v] of Object.entries(cfg!.authExtra)) url.searchParams.set(k, v);

    return json({ url: url.toString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
