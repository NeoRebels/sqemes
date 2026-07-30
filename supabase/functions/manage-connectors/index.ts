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
import { TOKEN_APPS } from '../_shared/connectorApps.ts';

const MCP_PROTOCOL = '2024-11-05';
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
    const res = await fetch(url, {
      method: 'POST',
      headers: hdrs(session),
      body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
    });
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

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const admin = createAdminClient();
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));

    // --- probe: validate a connector's MCP handshake + list its tools ---------------------------
    if (body.action === 'probe') {
      let url: string | undefined = body.mcpUrl;
      let token: string | null = body.token ?? null;
      if (body.connectorId) {
        const { data: row } = await admin.from('workspace_connectors')
          .select('id, workspace_id, user_id, mcp_url, provider, auth_token_encrypted, refresh_token_encrypted, token_expires_at')
          .eq('id', body.connectorId).single();
        if (!row) return json({ error: 'Connector not found' }, 404);
        const { data: mem } = await admin.from('workspace_members').select('role')
          .eq('workspace_id', row.workspace_id).eq('user_id', user.id).single();
        if (!mem || (row.user_id && row.user_id !== user.id)) return json({ error: 'Forbidden' }, 403);
        url = row.mcp_url;
        token = await getFreshConnectorToken(admin, row); // decrypts; refreshes an expired Google token
      }
      if (!url || !/^https:\/\//i.test(url)) return json({ error: 'A https:// mcpUrl is required' }, 400);
      try {
        return json({ ok: true, ...(await probeMcp(url, token)) });
      } catch (e) {
        // A failed probe is a user-facing test result, not a server error.
        return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // --- create: encrypt token server-side + insert ---------------------------------------------
    if (body.action === 'create') {
      const { workspaceId, name, mcpUrl, token, shared, allowedTools } = body;
      if (!workspaceId || !name?.trim() || !mcpUrl) return json({ error: 'workspaceId, name, mcpUrl are required' }, 400);
      if (!/^https:\/\//i.test(mcpUrl)) return json({ error: 'mcpUrl must be https://' }, 400);
      const { data: mem } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
      if (!mem) return json({ error: 'Not a member of this workspace' }, 403);
      if (shared && !['admin', 'editor'].includes(mem.role)) {
        return json({ error: 'Only admins or editors can add workspace-shared connectors' }, 403);
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
      if (!token?.trim()) return json({ error: 'An access token is required' }, 400);

      let mcpUrl = app.mcpUrl;
      if (app.needsShop) {
        let shop = String(body.shop || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/\.myshopify\.com$/.test(shop) && /^[a-z0-9][a-z0-9-]*$/.test(shop)) shop = `${shop}.myshopify.com`;
        if (!SHOP_RE.test(shop)) return json({ error: 'Enter your shop as {store}.myshopify.com' }, 400);
        mcpUrl = `${mcpUrl}?shop=${encodeURIComponent(shop)}`;
      }

      const { data: mem } = await admin.from('workspace_members').select('role')
        .eq('workspace_id', workspaceId).eq('user_id', user.id).single();
      if (!mem) return json({ error: 'Not a member of this workspace' }, 403);
      if (shared && !['admin', 'editor'].includes(mem.role)) {
        return json({ error: 'Only admins or editors can add workspace-shared connectors' }, 403);
      }
      const userId = shared ? null : user.id;
      // Reconnect replaces the caller's existing connector for this app (null-safe on the shared slot).
      let del = admin.from('workspace_connectors').delete()
        .eq('workspace_id', workspaceId).eq('provider', app.provider).eq('name', app.name);
      del = userId === null ? del.is('user_id', null) : del.eq('user_id', userId);
      await del;
      const { data: created, error } = await admin.from('workspace_connectors').insert({
        workspace_id: workspaceId,
        created_by: user.id,
        user_id: userId,
        name: app.name,
        provider: app.provider,
        mcp_url: mcpUrl,
        auth_token_encrypted: await encryptApiKey(String(token).trim()),
      }).select('id, name, mcp_url, user_id, allowed_tools, created_at').single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, connector: created });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
