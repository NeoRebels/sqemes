// SQEM-150/153/154 — begin a one-click OAuth-connector flow for an "app" (Gmail, Google Calendar/
// Docs/Sheets/Drive, Outlook, …). Authenticated: returns the provider consent URL carrying an encrypted
// `state` ({workspaceId, userId, app, exp}) so the public callback can trust who is connecting.
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey } from '../_shared/crypto.ts';
import { CONNECTOR_APPS, PROVIDERS } from '../_shared/connectorApps.ts';

const PUBLIC_API_URL = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
const REDIRECT_URI = `${PUBLIC_API_URL}/functions/v1/connector-oauth-callback`;

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { workspaceId, app: appId = 'google-gmail' } = await req.json().catch(() => ({}));
    const app = CONNECTOR_APPS[appId as string];
    if (!app) return json({ error: 'Unsupported app' }, 400);
    const cfg = PROVIDERS[app.provider];
    // SQEM-273 — trimmed for the same reason as the callback: a pasted value with trailing
    // whitespace would send a client_id the provider does not recognise, and nothing would say so.
    const clientId = (Deno.env.get(cfg.clientIdEnv) ?? '').trim();
    if (!clientId) return json({ error: `This connector is not configured on this instance (${cfg.clientIdEnv}).` }, 503);
    if (!workspaceId) return json({ error: 'workspaceId required' }, 400);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: mem } = await admin.from('workspace_members').select('role')
      .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
    if (!mem) return json({ error: 'Not a member of this workspace' }, 403);

    const state = await encryptApiKey(JSON.stringify({ w: workspaceId, u: user.id, a: appId, exp: Math.floor(Date.now() / 1000) + 600 }));
    const url = new URL(cfg.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', app.scopes.join(' '));
    url.searchParams.set('state', state);
    for (const [k, v] of Object.entries(cfg.authExtra)) url.searchParams.set(k, v);

    return json({ url: url.toString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
