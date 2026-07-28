// SQEM-150/153/154 — OAuth callback (public GET; the provider redirects the user's browser here).
// Verifies the encrypted `state`, exchanges the code for tokens, stores them encrypted, creates
// (replacing any prior of the same app) the user's connector, and redirects back to Settings. The app
// (from `state.a`) supplies the connector name + the MCP URL it points at (a Google hosted MCP, or our
// shim); the provider supplies the OAuth endpoints + scope-debug.
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey, decryptApiKey } from '../_shared/crypto.ts';
import { CONNECTOR_APPS, PROVIDERS } from '../_shared/connectorApps.ts';

const PUBLIC_API_URL = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
const REDIRECT_URI = `${PUBLIC_API_URL}/functions/v1/connector-oauth-callback`;
const APP_URL = (Deno.env.get('APP_URL') ?? PUBLIC_API_URL).trim().replace(/\/+$/, '');

Deno.serve(async (req) => {
  const back = (qs: string) => new Response(null, { status: 302, headers: { Location: `${APP_URL}/#/settings?tab=connectors&${qs}` } });

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return back(`connector=error&reason=${encodeURIComponent(oauthError)}`);
    if (!code || !state) return back('connector=error&reason=missing_code');

    let payload: { w?: string; u?: string; a?: string; exp?: number };
    try { payload = JSON.parse(await decryptApiKey(state)); } catch { return back('connector=error&reason=bad_state'); }
    if (!payload?.w || !payload?.u) return back('connector=error&reason=bad_state');
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return back('connector=error&reason=expired');

    const app = CONNECTOR_APPS[payload.a ?? 'google-gmail'];
    if (!app) return back('connector=error&reason=bad_app');
    const cfg = PROVIDERS[app.provider];

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get(cfg.clientIdEnv) ?? '',
        client_secret: Deno.env.get(cfg.clientSecretEnv) ?? '',
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok || !tok.access_token) return back('connector=error&reason=token_exchange');

    // Scope-debug: surface the actually-granted scopes; a missing read scope means data calls fail with
    // a permission error even though connect succeeds. Scopes aren't secret.
    const parts = String(tok.scope || '').split(/\s+/).filter(cfg.scopeFilter).map(cfg.scopeShort);
    const compact = parts.join(',');
    console.log(`[connector-oauth-callback] ${payload.a} granted scopes:`, compact || '(none)');

    const admin = createAdminClient();
    // Reconnect replaces the user's existing connector for THIS app (provider+name), not other apps.
    await admin.from('workspace_connectors').delete()
      .eq('workspace_id', payload.w).eq('user_id', payload.u).eq('provider', app.provider).eq('name', app.name);
    const { error } = await admin.from('workspace_connectors').insert({
      workspace_id: payload.w,
      created_by: payload.u,
      user_id: payload.u,
      name: app.name,
      mcp_url: app.mcpUrl,
      provider: app.provider,
      auth_token_encrypted: await encryptApiKey(tok.access_token),
      refresh_token_encrypted: tok.refresh_token ? await encryptApiKey(tok.refresh_token) : null,
      token_expires_at: new Date(Date.now() + ((tok.expires_in ?? 3600) * 1000)).toISOString(),
    });
    if (error) return back('connector=error&reason=save_failed');

    return back(`connector=connected&name=${encodeURIComponent(app.name)}&scopes=${encodeURIComponent(compact)}&read=${cfg.hasRead(parts) ? 1 : 0}`);
  } catch {
    return back('connector=error&reason=server');
  }
});
