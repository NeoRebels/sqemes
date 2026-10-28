// SQEM-149 — Connectors Phase 1a: manage external MCP connectors + probe them.
//
// Creation runs here (not client-direct) so the connector's bearer token is encrypted server-side
// with the same AES-GCM key as BYOK provider keys. `probe` is Sqemes' first MCP *client* call: it
// does the Streamable-HTTP handshake (initialize → initialized → tools/list) against a connector to
// validate reachability and show which tools it offers. List/delete of metadata are client-direct
// via RLS (`workspace_connectors`).
import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { encryptApiKey } from '../_shared/crypto.ts';
import { getFreshConnectorToken } from '../_shared/connectorToken.ts';
import { discoverAuthServer } from '../_shared/mcpOauth.ts';
import { TOKEN_APPS } from '../_shared/connectorApps.ts';
import { fetchShopifyToken, shopFromMcpUrl } from '../_shared/shopifyToken.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';
import { m as txt, requestLocale } from '../_shared/locale.ts';

const MCP_PROTOCOL = '2024-11-05';
/**
 * SQEM-467 — a probe must not be able to hang the request that is waiting for it.
 *
 * ⚠️ Ten seconds is a handshake budget, not a work budget: `initialize` + `tools/list` are two small
 * round trips. It is deliberately far below the platform's own limit so a dead host fails as a
 * readable sentence rather than as a timed-out function.
 */
const PROBE_TIMEOUT_MS = 10_000;
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// Minimal MCP client probe over Streamable HTTP. Handles JSON *and* SSE responses + Mcp-Session-Id.
async function probeMcp(url: string, token: string | null): Promise<{ serverName?: string; tools: { name: string; description?: string }[] }> {
  const hdrs = (session?: string | null) => {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (token) h.authorization = `Bearer ${token}`;
    if (session) h['mcp-session-id'] = session;
    return h;
  };
  const readRpc = async (res: Response) => {
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    if (ct.includes('application/json')) { try { return JSON.parse(text); } catch { return null; } }
    // SSE: the JSON-RPC payload rides `data:` lines
    const payloads = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
    for (const p of payloads.reverse()) { try { return JSON.parse(p); } catch { /* keep scanning */ } }
    return null;
  };
  const rpc = async (method: string, params: unknown, session: string | null, id?: number) => {
    // SQEM-467 — ⚠️ `fetchWithTimeout`'s own abort message says "LLM provider did not respond",
    // which is wrong for an MCP server. It is translated here rather than at the call sites, so the
    // existing `probe` action cannot start showing provider wording for a connector.
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: hdrs(session),
        body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
      }, PROBE_TIMEOUT_MS);
    } catch (e) {
      if ((e as { status?: number })?.status === 504) {
        throw new Error(`${method}: no answer within ${PROBE_TIMEOUT_MS / 1000} seconds`);
      }
      throw e;
    }
    const newSession = res.headers.get('mcp-session-id') || session;
    if (!res.ok && id !== undefined) throw new Error(`${method} → HTTP ${res.status}`);
    const body = id === undefined ? null : await readRpc(res);
    return { session: newSession, body };
  };

  const init = await rpc('initialize', { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'sqemes', version: '1.0' } }, null, 1);
  if (init.body?.error) throw new Error(`initialize: ${init.body.error.message || 'error'}`);
  const session = init.session;
  await rpc('notifications/initialized', {}, session); // notification (no id)
  const list = await rpc('tools/list', {}, session, 2);
  if (list.body?.error) throw new Error(`tools/list: ${list.body.error.message || 'error'}`);
  const tools = (list.body?.result?.tools || []).map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description }));
  return { serverName: init.body?.result?.serverInfo?.name, tools };
}

/**
 * SQEM-467 — ask the server before we claim a connection.
 *
 * ⛔ **Until this existed, "Connected" meant "we stored a non-empty string."** Two customer cases
 * came out of that on the same day: a Shopify tile holding an `shpss_` client secret (not an access
 * token at all), and two Plaud rows with no token whatsoever, left behind by an OAuth flow that was
 * begun and never finished. Both showed as connected. The second kind is worse than cosmetic —
 * Anthropic fails the ENTIRE request when one listed MCP server refuses the token, so one dead
 * connector killed every Claude message its owner sent (SQEM-466).
 *
 * ⭐ **Why a probe and not a rule about tokens.** A connector without a token is not necessarily
 * broken: `Shopify Storefront` is public by design and legitimately carries none. Its row is
 * indistinguishable from the dead Plaud one — same shape, same empty column. Only the server knows
 * the difference, so we ask it. A stored `auth_kind` would be a second truth that can drift from the
 * first; this one cannot, because it is measured at the moment it matters.
 *
 * Returns the server's own words on failure, `null` on success.
 */
async function whyUnreachable(url: string, token: string | null): Promise<string | null> {
  try {
    await probeMcp(url, token);
    return null;
  } catch (e) {
    // ⚠️ The server's sentence is the useful half — never replace it with "connection failed".
    // `lib/aiErrors.ts` in the source repository spells out what that costs (SQEM-273).
    return e instanceof Error ? e.message : String(e);
  }
}

Deno.serve(async (req) => {
  const locale = requestLocale(req); // SQEM-612 — refusals in the person's language
  const cors = getCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return json({ error: txt.srv_unauthorized({}, { locale }) }, 401);

    const body = await req.json().catch(() => ({}));

    // --- probe: validate a connector's MCP handshake + list its tools ---------------------------
    if (body.action === 'probe') {
      let url: string | undefined = body.mcpUrl;
      let token: string | null = body.token ?? null;
      if (body.connectorId) {
        const { data: row } = await admin.from('workspace_connectors')
          .select('id, workspace_id, user_id, mcp_url, provider, auth_token_encrypted, refresh_token_encrypted, token_expires_at, oauth_client_id, oauth_client_secret_encrypted')
          .eq('id', body.connectorId).single();
        if (!row) return json({ error: txt.srv_connector_not_found({}, { locale }) }, 404);
        const { data: mem } = await admin.from('workspace_members').select('role')
          .eq('workspace_id', row.workspace_id).eq('user_id', user.id).single();
        if (!mem || (row.user_id && row.user_id !== user.id)) return json({ error: txt.srv_forbidden({}, { locale }) }, 403);
        url = row.mcp_url;
        token = await getFreshConnectorToken(admin, row); // decrypts; refreshes an expired Google token
      }
      if (!url || !/^https:\/\//i.test(url)) return json({ error: txt.srv_https_required({}, { locale }) }, 400);
      try {
        return json({ ok: true, ...(await probeMcp(url, token)) });
      } catch (e) {
        // A failed probe is a user-facing test result, not a server error.
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    /**
     * SQEM-444 — ask the server what it wants, so the dialog does not ask the person.
     *
     * Four shapes exist (SQEM-426/429/430/437/439/441), and until now each was reachable only through
     * a tile we had shipped. The information that decides between them is in the server's own answer:
     *
     *   200 on `initialize`            → no authentication at all  (Shopify Storefront)
     *   401 + registration_endpoint    → dynamic registration      (Plaud, Notion, Noota)
     *   401, no registration           → a client id must be entered (Nifty)
     *   anything else                  → fall back to a pasted token
     *
     * ⚠️ Discovery is the same `POST initialize` as everywhere else — a GET returns 404 at some
     * servers and would make an OAuth server look unauthenticated (SQEM-429).
     *
     * ⚠️ `scopes` is returned because leaving it out cost SQEM-439 a whole round: a consent screen
     * with no scope to show rejects the request with an error that names neither.
     */
    if (body.action === 'inspect') {
      const url: string | undefined = body.mcpUrl;
      if (!url || !/^https:\/\//i.test(url)) return json({ error: txt.srv_https_required({}, { locale }) }, 400);
      try {
        const open = await probeMcp(url, null);
        return json({ ok: true, kind: 'none', serverName: open.serverName, tools: open.tools });
      } catch {
        // Not reachable without a token — which is the normal case, not a failure.
      }
      try {
        const meta = await discoverAuthServer(url);
        return json({
          ok: true,
          kind: 'oauth',
          issuer: meta.issuer,
          registration: !!meta.registration_endpoint,
          scopes: meta.scopes_supported ?? [],
        });
      } catch (e) {
        // No usable OAuth metadata: the server may still take a static bearer token, so say that
        // rather than declaring it broken.
        return json({ ok: true, kind: 'token', reason: e instanceof Error ? e.message : String(e) });
      }
    }

    /**
     * SQEM-438 — set which of a connector's tools may be used.
     *
     * ⛔ **This needs an edge function because the browser cannot write the row at all.**
     * `workspace_connectors` has a SELECT and a DELETE policy and deliberately no INSERT/UPDATE one
     * (SQEM-149), so that tokens are only ever encrypted server-side. A settings dialog that reached
     * for `supabase.from('workspace_connectors').update(...)` would fail with `permission denied`,
     * and the fix would not be a policy — it would be this.
     *
     * ⚠️ **The permission mirrors the DELETE policy word for word**: your own personal connector, or a
     * workspace-shared one if you are admin/editor. A second, slightly different rule about the same
     * row is how two answers to one question come about.
     *
     * ⚠️ `tools: null` means **"no restriction"**, which is NOT the same as ticking every box. With no
     * restriction the provider's own future tools are included automatically; with an explicit list
     * the set is frozen and a tool added later is silently missing. The dialog says so; this function
     * only has to keep the two states distinguishable — hence `null`, never `[]`.
     */
    if (body.action === 'set-tools') {
      const { connectorId, tools } = body;
      if (!connectorId) return json({ error: 'connectorId required' }, 400);
      if (tools !== null && !Array.isArray(tools)) return json({ error: 'tools must be an array or null' }, 400);
      const { data: row } = await admin.from('workspace_connectors')
        .select('id, workspace_id, user_id')
        .eq('id', connectorId).single();
      if (!row) return json({ error: txt.srv_connector_not_found({}, { locale }) }, 404);
      const { data: mem } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', row.workspace_id).eq('user_id', user.id).single();
      if (!mem) return json({ error: txt.srv_not_member({}, { locale }) }, 403);
      const mayEdit = row.user_id
        ? row.user_id === user.id
        : ['admin', 'editor'].includes(mem.role);
      if (!mayEdit) return json({ error: txt.srv_forbidden({}, { locale }) }, 403);
      // An empty array would mean "no tools at all", which nothing in the product can express and
      // which reads exactly like "all of them" in the UI. It collapses to null on purpose.
      const allowed = Array.isArray(tools) && tools.length ? tools.map(String) : null;
      const { error } = await admin.from('workspace_connectors')
        .update({ allowed_tools: allowed }).eq('id', connectorId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, allowedTools: allowed });
    }

    // --- create: encrypt token server-side + insert ---------------------------------------------
    if (body.action === 'create') {
      const { workspaceId, name, mcpUrl, token, shared, allowedTools } = body;
      if (!workspaceId || !name?.trim() || !mcpUrl) return json({ error: 'workspaceId, name, mcpUrl are required' }, 400);
      if (!/^https:\/\//i.test(mcpUrl)) return json({ error: txt.srv_https_only({}, { locale }) }, 400);
      const { data: mem } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
      if (!mem) return json({ error: txt.srv_not_member({}, { locale }) }, 403);
      if (shared && !['admin', 'editor'].includes(mem.role)) {
        return json({ error: txt.srv_shared_connector_role({}, { locale }) }, 403);
      }
      const row = {
        workspace_id: workspaceId,
        created_by: user.id,
        user_id: shared ? null : user.id,
        name: String(name).trim(),
        mcp_url: mcpUrl,
        auth_token_encrypted: token ? await encryptApiKey(token) : null,
        allowed_tools: Array.isArray(allowedTools) && allowedTools.length ? allowedTools : null,
      };
      // SQEM-467 — this is the path every broken row on production came through. Probe first.
      const why = await whyUnreachable(mcpUrl, token ?? null);
      if (why) return json({ error: txt.srv_server_refused({ why }, { locale }) }, 400);

      const { data: created, error } = await admin.from('workspace_connectors')
        .insert(row).select('id, name, mcp_url, user_id, allowed_tools, created_at').single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, connector: created });
    }

    // --- create-token (SQEM-157/159): a token-paste app (Shopify/GitHub/Notion). The user pastes a
    // static token; we encrypt it + point the connector at the app's mcpUrl (a vendor-hosted MCP or our
    // shim). `needsShop` apps (Shopify) append a validated ?shop=. No OAuth, no secret. --------------
    if (body.action === 'create-token') {
      const { workspaceId, app: appId, token, shared } = body;
      const app = TOKEN_APPS[appId as string];
      if (!app) return json({ error: 'Unsupported app' }, 400);
      if (!workspaceId) return json({ error: 'workspaceId required' }, 400);
      if (!token?.trim()) return json({ error: app.needsSecret ? txt.srv_client_id_required({}, { locale }) : txt.srv_token_required({}, { locale }) }, 400);
      if (app.needsSecret && !String(body.secret ?? '').trim()) return json({ error: txt.srv_secret_required({}, { locale }) }, 400);

      let mcpUrl = app.mcpUrl;
      if (app.needsShop) {
        let shop = String(body.shop || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/\.myshopify\.com$/.test(shop) && /^[a-z0-9][a-z0-9-]*$/.test(shop)) shop = `${shop}.myshopify.com`;
        if (!SHOP_RE.test(shop)) return json({ error: txt.srv_shop_format({ example: '{store}.myshopify.com' }, { locale }) }, 400);
        mcpUrl = `${mcpUrl}?shop=${encodeURIComponent(shop)}`;
      }

      const { data: mem } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
      if (!mem) return json({ error: txt.srv_not_member({}, { locale }) }, 403);
      if (shared && !['admin', 'editor'].includes(mem.role)) {
        return json({ error: txt.srv_shared_connector_role({}, { locale }) }, 403);
      }
      const userId = shared ? null : user.id;
      // Reconnect replaces the caller's existing connector for this app (null-safe on the shared slot).
      let del = admin.from('workspace_connectors').delete()
        .eq('workspace_id', workspaceId).eq('provider', app.provider).eq('name', app.name);
      del = userId === null ? del.is('user_id', null) : del.eq('user_id', userId);
      await del;
      /**
       * SQEM-469 — for a credentials app the pasted value is a client ID, and the token is minted.
       *
       * ⭐ Doing it here rather than lazily means the person learns at setup time what Shopify
       * thinks of their app — not tomorrow, and not as a 401 inside a chat message. The exchange
       * rejects an empty `scope`, which is the state a customer reached twice on 2026-09-25: the
       * app installed, the token valid, and every data call answering 403.
       */
      const storedTokenClientId = String(token).trim();
      let storedToken = storedTokenClientId;
      let tokenExpiresAt: string | null = null;
      if (app.needsSecret) {
        const shop = shopFromMcpUrl(mcpUrl);
        if (!shop) return json({ error: txt.srv_shop_format({ example: '{store}.myshopify.com' }, { locale }) }, 400);
        try {
          const grant = await fetchShopifyToken(shop, storedToken, String(body.secret).trim());
          storedToken = grant.accessToken;
          tokenExpiresAt = grant.expiresAt;
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 400);
        }
      }

      // SQEM-467 — the tile path. A pasted string that looks like a token is not a token: a customer
      // pasted his app's `shpss_` client secret here and the tile reported "Connected".
      const whyToken = await whyUnreachable(mcpUrl, storedToken);
      if (whyToken) return json({ error: txt.srv_token_refused({ why: whyToken }, { locale }) }, 400);

      const { data: created, error } = await admin.from('workspace_connectors').insert({
        workspace_id: workspaceId,
        created_by: user.id,
        user_id: userId,
        name: app.name,
        provider: app.provider,
        mcp_url: mcpUrl,
        auth_token_encrypted: await encryptApiKey(storedToken),
        // SQEM-469 — the credentials stay so the token can be minted again; without them the
        // connector would die 24 hours later with no way back.
        ...(app.needsSecret ? {
          oauth_client_id: storedTokenClientId,
          oauth_client_secret_encrypted: await encryptApiKey(String(body.secret).trim()),
          token_expires_at: tokenExpiresAt,
        } : {}),
      }).select('id, name, mcp_url, user_id, allowed_tools, created_at').single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, connector: created });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
