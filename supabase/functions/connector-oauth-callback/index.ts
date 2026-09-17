// SQEM-150/153/154 — OAuth callback (public GET; the provider redirects the user's browser here).
// Verifies the encrypted `state`, exchanges the code for tokens, stores them encrypted, creates
// (replacing any prior of the same app) the user's connector, and redirects back to Settings. The app
// (from `state.a`) supplies the connector name + the MCP URL it points at (a Google hosted MCP, or our
// shim); the provider supplies the OAuth endpoints + scope-debug.
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey, decryptApiKey } from '../_shared/crypto.ts';
import { CONNECTOR_APPS, MCP_OAUTH_APPS, PROVIDERS, mcpClientIdSource } from '../_shared/connectorApps.ts';
import { discoverAuthServer, getOrRegisterClient } from '../_shared/mcpOauth.ts';

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

    /**
     * SQEM-443 — an error that arrives AFTER the connector already exists is not a failure.
     *
     * Observed with Nifty on 2026-09-17: the tile said connected and a toast said
     * *"Connection failed: invalid_request"* in the same breath. Both were true. An authorization
     * request can reach this callback twice — the consent screen's own navigation, a back button, a
     * re-fired URL — and the second arrival presents a code that has already been spent, so the
     * provider answers `error=invalid_request`. The first one had already created the connector.
     *
     * ⛔ Reporting that as a failure is worse than saying nothing: it contradicts what the person can
     * see, and it invites them to reconnect something that works. So: if the state still names the
     * app and the connector is already there, report the truth.
     *
     * ⚠️ Only when the state decrypts AND names a connector that exists. A provider error with no
     * usable state stays an error — this must not become a way to swallow real failures.
     */
    let payload: { w?: string; u?: string; a?: string; exp?: number; k?: string; v?: string; i?: string; c?: string; s?: string; m?: string; n?: string } = {};
    let stateOk = false;
    if (state) {
      try { payload = JSON.parse(await decryptApiKey(state)); stateOk = true; } catch { stateOk = false; }
    }

    if (oauthError) {
      if (stateOk && payload.w && payload.u) {
        const appName = (MCP_OAUTH_APPS[payload.a ?? '']?.name) ?? (CONNECTOR_APPS[payload.a ?? '']?.name);
        if (appName) {
          const { data: existing } = await createAdminClient().from('workspace_connectors')
            .select('id').eq('workspace_id', payload.w).eq('user_id', payload.u).eq('name', appName).maybeSingle();
          if (existing) return back(`connector=connected&name=${encodeURIComponent(appName)}`);
        }
      }
      /**
       * ⛔ SQEM-448 — carry the provider's OWN words, not just its code.
       *
       * The token-exchange branch has done this since SQEM-273, with a comment noting that Microsoft's
       * `AADSTS…` only becomes visible through `error_description`. This branch never got the lesson,
       * so a redirect error arrived as a bare `invalid_request` — a code that fits a dozen causes and
       * names none of them. Two rounds were spent guessing at exactly that.
       *
       * ⚠️ Logged as well as redirected: a redirect URL can be truncated by anything along the way,
       * a log line cannot.
       */
      const desc = url.searchParams.get('error_description') ?? '';
      console.error('[connector-oauth] provider redirected with an error', JSON.stringify({
        error: oauthError, description: desc.slice(0, 500), uri: url.searchParams.get('error_uri') ?? '',
      }));
      const descParam = desc ? `&desc=${encodeURIComponent(desc.slice(0, 300))}` : '';
      return back(`connector=error&reason=${encodeURIComponent(oauthError)}${descParam}`);
    }

    if (!code || !state) return back('connector=error&reason=missing_code');
    if (!stateOk) return back('connector=error&reason=bad_state');
    if (!payload?.w || !payload?.u) return back('connector=error&reason=bad_state');
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return back('connector=error&reason=expired');

    // ---- SQEM-426: the MCP kind exchanges with PKCE and a registered (usually secretless) client ----
    if (payload.k === 'mcp') {
      /**
       * SQEM-444 — either a registry app, or the ad-hoc target whose name and URL travelled in the
       * state. Everything after this point treats the two identically.
       */
      const mcpApp = MCP_OAUTH_APPS[payload.a ?? ''] ?? (payload.m && payload.n
        ? { provider: 'mcp', name: payload.n, mcpUrl: payload.m, scopes: undefined }
        : undefined);
      if (!mcpApp || !payload.v) return back('connector=error&reason=bad_app');
      const admin = createAdminClient();
      try {
        const meta = await discoverAuthServer(mcpApp.mcpUrl);
        const exchange = async (forceNew: boolean) => {
          // SQEM-437 — `payload.c` is the client id the person entered at connect time. It wins
          // over the app's configured one for the same reason it did in `connector-oauth-start`:
          // the exchange MUST present the client the authorization was granted to.
          const client = await getOrRegisterClient(admin, meta, REDIRECT_URI, {
            forceNew,
            ...(MCP_OAUTH_APPS[payload.a ?? ''] ? mcpClientIdSource(mcpApp) : {}),
            ...(payload.c ? { configuredClientId: payload.c } : {}),
            ...(payload.s ? { configuredClientSecret: payload.s } : {}),
          });
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: REDIRECT_URI,
            client_id: client.clientId,
            code_verifier: payload.v!,
            resource: meta.resource ?? mcpApp.mcpUrl, // SQEM-449 — declared, not constructed
          });
          // A server that issued a secret expects it back; a public client must NOT send one.
          if (client.clientSecret) body.set('client_secret', client.clientSecret);
          const r = await fetch(meta.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          });
          return { r, json: await r.json().catch(() => ({} as Record<string, unknown>)) };
        };

        let { r, json: tok } = await exchange(false);
        /**
         * ⛔ **One retry with a fresh registration, and only for `invalid_client`.** A registration can
         * be expired or revoked on the other side, and the only symptom is this error — which reads
         * like the user's fault. Without the retry a connector stays broken forever and nobody can see
         * why. ⚠️ Not a blanket retry: any other error means the code, the verifier or the redirect URI
         * is wrong, and registering a second client would just litter the provider's account.
         */
        if (!r.ok && String((tok as { error?: string }).error ?? '') === 'invalid_client') {
          console.warn(`[connector-oauth-callback] ${payload.a}: invalid_client — re-registering once`);
          ({ r, json: tok } = await exchange(true));
        }
        if (!r.ok || !tok.access_token) {
          console.error(`[connector-oauth-callback] ${payload.a} MCP token exchange failed`, r.status,
            (tok as { error?: string }).error ?? '(no error field)',
            (tok as { error_description?: string }).error_description ?? '');
          return back(`connector=error&reason=token_exchange&code=${encodeURIComponent(String((tok as { error?: string }).error ?? r.status))}`);
        }

        await admin.from('workspace_connectors').delete()
          .eq('workspace_id', payload.w).eq('user_id', payload.u).eq('provider', mcpApp.provider).eq('name', mcpApp.name);
        const { error: saveErr } = await admin.from('workspace_connectors').insert({
          workspace_id: payload.w,
          created_by: payload.u,
          user_id: payload.u,
          name: mcpApp.name,
          mcp_url: mcpApp.mcpUrl,
          provider: mcpApp.provider,
          auth_token_encrypted: await encryptApiKey(String(tok.access_token)),
          refresh_token_encrypted: tok.refresh_token ? await encryptApiKey(String(tok.refresh_token)) : null,
          token_expires_at: new Date(Date.now() + ((Number(tok.expires_in) || 3600) * 1000)).toISOString(),
          // ⛔ SQEM-437 — persisted for the REFRESH. The `state` that carried it is gone within
          // minutes; without this column the connector works for an hour and then dies with a bare
          // provider 401 (the SQEM-347 class).
          ...(payload.c ? { oauth_client_id: payload.c } : {}),
          // SQEM-439 — encrypted, like every other credential on this row. The refresh needs it as
          // much as the id does.
          ...(payload.s ? { oauth_client_secret_encrypted: await encryptApiKey(payload.s) } : {}),
        });
        if (saveErr) return back('connector=error&reason=save_failed');
        return back(`connector=connected&name=${encodeURIComponent(mcpApp.name)}`);
      } catch (e) {
        console.error(`[connector-oauth-callback] ${payload.a} MCP flow failed:`, e instanceof Error ? e.message : String(e));
        return back('connector=error&reason=mcp_oauth');
      }
    }

    const app = CONNECTOR_APPS[payload.a ?? 'google-gmail'];
    if (!app) return back('connector=error&reason=bad_app');
    const cfg = PROVIDERS[app.provider];

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        // SQEM-273 — `.trim()`, and it is not defensive noise. This project has three recorded cases
        // of a pasted env value carrying trailing whitespace and breaking something:
        // a newline in `VITE_SUPABASE_ANON_KEY`, a space in
        // `PUBLIC_API_URL`. Both were fixed by trimming — and the URLs in this very file are trimmed
        // while the credentials were not. A secret with a trailing newline is rejected as
        // `invalid_client`, which reads exactly like an expired secret and is invisible in the
        // dashboard, so the wrong thing gets replaced.
        client_id: (Deno.env.get(cfg.clientIdEnv) ?? '').trim(),
        client_secret: (Deno.env.get(cfg.clientSecretEnv) ?? '').trim(),
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tok = await tokenRes.json().catch(() => ({} as Record<string, unknown>));
    if (!tokenRes.ok || !tok.access_token) {
      // SQEM-273 — say WHICH failure it was. This used to return a bare `token_exchange`, which is
      // the one thing the provider never tells you: the response body carries `error` and
      // `error_description` (Microsoft's `AADSTS…`, Google's equivalent) naming the actual cause —
      // an expired or mistyped client secret, a redirect_uri that differs from the authorize step, a
      // reused code. Discarding it left six candidates and no way to choose between them, at the one
      // moment somebody is stuck.
      //
      // Logged in full server-side, and the short machine code travels back in the URL so the person
      // can quote it. **Neither is secret** — the same reasoning as the granted-scopes log below;
      // the secret is what we *sent*, and that is never in this response.
      console.error(
        `[connector-oauth-callback] ${payload.a} token exchange failed`,
        tokenRes.status,
        (tok as { error?: string }).error ?? '(no error field)',
        (tok as { error_description?: string }).error_description ?? '',
      );
      const code = String((tok as { error?: string }).error ?? tokenRes.status);
      return back(`connector=error&reason=token_exchange&code=${encodeURIComponent(code)}`);
    }

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
