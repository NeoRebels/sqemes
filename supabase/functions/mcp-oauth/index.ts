import { createAdminClient } from '../_shared/supabase-admin.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')      ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// SQEM-088 — the externally-advertised base for the OAuth issuer/endpoints + MCP URL.
// Set PUBLIC_API_URL to the Supabase custom domain (e.g. https://api.sqemes.com) so what
// we advertise matches the domain clients actually connect to — otherwise the OAuth
// issuer mismatches and Claude's authorize flow breaks. Unset → the auto-injected project
// URL (today's behaviour). Internal calls (admin client, broadcast) keep SUPABASE_URL.
const PUBLIC_API_URL    = (Deno.env.get('PUBLIC_API_URL') ?? SUPABASE_URL).trim().replace(/\/+$/, '');
const OAUTH_BASE        = `${PUBLIC_API_URL}/functions/v1/mcp-oauth`;
const MCP_SERVER        = `${PUBLIC_API_URL}/functions/v1/mcp-server`;
// APP_URL is the Vercel app root — must be set per-environment in Supabase project secrets.
// Claude Desktop's MCP SDK resolves OAuth metadata as new URL('/.well-known/oauth-authorization-server', issuer),
// which strips the Supabase function path and hits the domain root (unreachable for edge functions).
// Pointing authorization_servers at the Vercel root lets the SDK discover metadata we CAN serve.
const APP_URL           = Deno.env.get('APP_URL')           ?? OAUTH_BASE;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// SQEM-065: OAuth access tokens are short-lived (1h) and rotated via a refresh
// token that carries the user-chosen connection lifetime.
const ACCESS_TTL_SECONDS = 3600;

// ---- Helpers ----

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function getSubPath(url: URL): string {
  const prefix = '/mcp-oauth';
  const p = url.pathname;
  if (p === prefix || p === prefix + '/') return '/';
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

async function verifyPKCE(verifier: string, challenge: string): Promise<boolean> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return b64 === challenge;
}

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// SQEM-107 — the auth code is delivered to this redirect_uri, so only trust targets a
// legitimate MCP client would use: https for hosted clients (claude.ai / Claude web) and
// loopback http for native clients (Claude Desktop binds a localhost callback port). This
// blocks phishing/open-redirect callbacks (javascript:/data:/file:, http://<non-loopback>)
// that could otherwise hand an attacker a code for the victim's workspace.
function isAllowedRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || !uri) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') {
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }
  return false;
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });

  const url  = new URL(req.url);
  const path = getSubPath(url);

  // ---- RFC 9728: OAuth Protected Resource Metadata ----
  if (req.method === 'GET' && path === '/.well-known/oauth-protected-resource') {
    return json({
      resource: MCP_SERVER,
      authorization_servers: [APP_URL],
    });
  }

  // ---- RFC 8414: Authorization Server Metadata ----
  if (req.method === 'GET' && (path === '/.well-known/oauth-authorization-server' || path === '/')) {
    return json({
      issuer: OAUTH_BASE,
      authorization_endpoint: `${OAUTH_BASE}/authorize`,
      token_endpoint: `${OAUTH_BASE}/token`,
      registration_endpoint: `${OAUTH_BASE}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }

  // ---- RFC 7591: Dynamic Client Registration ----
  if (req.method === 'POST' && path === '/register') {
    let body: any = {};
    try { body = await req.json(); } catch { /* body is optional */ }
    const clientId = randomHex(16);
    return json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris ?? [],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  }

  // ---- GET /authorize — redirect to Vercel-hosted login page ----
  // Supabase's Cloudflare gateway overrides Content-Type to text/plain and
  // injects `content-security-policy: default-src 'none'; sandbox`, which
  // breaks inline scripts. Serve the UI from Vercel instead.
  if (req.method === 'GET' && path === '/authorize') {
    const dest = new URL(`${APP_URL}/oauth/authorize`);
    url.searchParams.forEach((v, k) => dest.searchParams.set(k, v));
    return new Response(null, {
      status: 302,
      headers: { ...CORS, Location: dest.toString() },
    });
  }

  // ---- POST /authorize — verify user + create auth code ----
  if (req.method === 'POST' && path === '/authorize') {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_request' }, 400); }

    const { access_token, workspace_id, code_challenge, code_challenge_method, redirect_uri, state, client_id, name } = body;

    if (!access_token || !workspace_id || !code_challenge || !redirect_uri) {
      return json({ error: 'invalid_request', error_description: 'Missing required fields' }, 400);
    }

    // SQEM-107 — reject untrusted redirect targets before minting a code for them.
    if (!isAllowedRedirectUri(redirect_uri)) {
      return json({ error: 'invalid_request', error_description: 'redirect_uri must be https or a loopback (localhost) address' }, 400);
    }

    // SQEM-068: OAuth connections are always born read-only + never-expiring; the consent
    // screen only names them. Scope + lifetime are then managed by an admin/editor in the
    // Sqemes Integrations tab.
    const connectionName: string = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 60) : 'Claude Desktop';

    const admin = createAdminClient();

    // Verify the Supabase access token
    const { data: { user }, error: userErr } = await admin.auth.getUser(access_token);
    if (userErr || !user) {
      return json({ error: 'access_denied', error_description: 'Invalid access token' }, 401);
    }

    // Verify workspace membership
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user.id)
      .single();

    if (!member) {
      return json({ error: 'access_denied', error_description: 'Not a member of this workspace' }, 403);
    }

    // Store auth code (code generated by DB default)
    const code = randomHex(32);
    const { error: insertErr } = await admin.from('mcp_auth_codes').insert({
      code,
      workspace_id,
      user_id: user.id,
      code_challenge,
      code_challenge_method: code_challenge_method || 'S256',
      redirect_uri,
      state: state || null,
      client_id: client_id || null,
      name: connectionName,
      scopes: ['read'],
      key_expires_at: null,
    });

    if (insertErr) {
      return json({ error: 'server_error', error_description: 'Failed to create auth code' }, 500);
    }

    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    return json({ redirect_url: callbackUrl.toString() });
  }

  // ---- POST /token — exchange code for access token ----
  if (req.method === 'POST' && path === '/token') {
    // Accept both JSON and form-encoded (Claude Desktop may use either)
    let params: Record<string, string>;
    const ct = req.headers.get('content-type') ?? '';
    try {
      params = ct.includes('application/json')
        ? await req.json()
        : Object.fromEntries(new URLSearchParams(await req.text()));
    } catch { return json({ error: 'invalid_request' }, 400); }

    const { grant_type, code, code_verifier, redirect_uri, refresh_token } = params;

    const admin = createAdminClient();

    // ---- grant_type=refresh_token — rotate the connection's access + refresh tokens (SQEM-065) ----
    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
      }

      const presentedHash = await hashKey(refresh_token);
      const { data: rt } = await admin
        .from('mcp_refresh_tokens')
        .select('*')
        .eq('token_hash', presentedHash)
        .single();

      if (!rt) {
        return json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
      }

      // Reuse detection: a replayed (already-rotated) token signals compromise —
      // revoke every refresh token for the connection. Its access token expires within 1h.
      if (rt.revoked) {
        await admin.from('mcp_refresh_tokens').update({ revoked: true }).eq('key_id', rt.key_id);
        return json({ error: 'invalid_grant', error_description: 'Refresh token already used' }, 400);
      }

      // Connection lifetime is authoritative on the key row (so it stays editable in the
      // Integrations tab via the admin/editor RLS policy — SQEM-068).
      const { data: connKey } = await admin
        .from('sqemes_api_keys')
        .select('connection_expires_at')
        .eq('id', rt.key_id)
        .single();
      const connectionLifetime: string | null = connKey?.connection_expires_at ?? null;
      if (connectionLifetime && new Date(connectionLifetime) < new Date()) {
        return json({ error: 'invalid_grant', error_description: 'Connection expired; re-authorize' }, 400);
      }

      // Rotate: invalidate the presented token.
      await admin.from('mcp_refresh_tokens').update({ revoked: true }).eq('id', rt.id);

      // Mint a new short-lived access token and rotate it onto the connection row IN PLACE.
      const newKey       = `sqm_live_${randomHex(16)}`;
      const newKeyPrefix = newKey.substring(0, 16) + '...';
      const newKeyHash   = await hashKey(newKey);
      const nowPlusTtl   = Date.now() + ACCESS_TTL_SECONDS * 1000;
      // Never let the access token outlive the connection lifetime.
      const accessExp    = connectionLifetime
        ? new Date(Math.min(nowPlusTtl, new Date(connectionLifetime).getTime())).toISOString()
        : new Date(nowPlusTtl).toISOString();

      const { data: updatedKey, error: updErr } = await admin
        .from('sqemes_api_keys')
        .update({ key_hash: newKeyHash, key_prefix: newKeyPrefix, expires_at: accessExp })
        .eq('id', rt.key_id)
        .select('scopes')
        .single();
      if (updErr || !updatedKey) {
        return json({ error: 'server_error', error_description: 'Failed to rotate access token' }, 500);
      }

      // The connection's key row is the source of truth for scopes, so edits made in
      // the Integrations tab persist across refreshes.
      const currentScopes: string[] = Array.isArray(updatedKey.scopes) && updatedKey.scopes.length > 0
        ? updatedKey.scopes
        : ['read'];

      // Issue the next refresh token (same connection lifetime; scopes synced to the key row).
      const newRefresh     = `sqm_refresh_${randomHex(32)}`;
      const newRefreshHash = await hashKey(newRefresh);
      const { error: insErr } = await admin.from('mcp_refresh_tokens').insert({
        token_hash:   newRefreshHash,
        key_id:       rt.key_id,
        workspace_id: rt.workspace_id,
        scopes:       currentScopes,
        expires_at:   connectionLifetime,
      });
      if (insErr) {
        return json({ error: 'server_error', error_description: 'Failed to issue refresh token' }, 500);
      }

      return json({
        access_token:  newKey,
        refresh_token: newRefresh,
        token_type:    'bearer',
        expires_in:    Math.max(0, Math.floor((new Date(accessExp).getTime() - Date.now()) / 1000)),
        scope:         currentScopes.join(' '),
      });
    }

    // ---- grant_type=authorization_code ----
    if (grant_type !== 'authorization_code' || !code || !code_verifier || !redirect_uri) {
      return json({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
    }

    const { data: authCode } = await admin
      .from('mcp_auth_codes')
      .select('*')
      .eq('code', code)
      .eq('redirect_uri', redirect_uri)
      .eq('used', false)
      .single();

    if (!authCode) {
      return json({ error: 'invalid_grant', error_description: 'Invalid or expired auth code' }, 400);
    }

    if (new Date(authCode.expires_at) < new Date()) {
      return json({ error: 'invalid_grant', error_description: 'Auth code expired' }, 400);
    }

    const pkceOk = await verifyPKCE(code_verifier, authCode.code_challenge);
    if (!pkceOk) {
      return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    // SQEM-111 — atomically claim the code before issuing the token. The winner of the
    // `used = false → true` update proceeds; a concurrent second exchange gets no row and is
    // rejected (closes the select-then-update TOCTOU / double-issue race).
    const { data: claimed } = await admin
      .from('mcp_auth_codes')
      .update({ used: true })
      .eq('code', code)
      .eq('used', false)
      .select('code')
      .maybeSingle();
    if (!claimed) {
      return json({ error: 'invalid_grant', error_description: 'Auth code already used' }, 400);
    }

    // Scope + connection lifetime chosen on the consent screen, carried via the auth code.
    const grantedScopes: string[] = Array.isArray(authCode.scopes) && authCode.scopes.length > 0
      ? authCode.scopes
      : ['read'];
    const connectionExpiresAt: string | null = authCode.key_expires_at ?? null; // null = never

    // Issue a SHORT-LIVED access token (sqm_live_). mcp-server auths against this and
    // 401s when it expires; the client then rotates it via the refresh token (SQEM-065).
    const rawKey          = `sqm_live_${randomHex(16)}`;
    const keyPrefix       = rawKey.substring(0, 16) + '...';
    const keyHash         = await hashKey(rawKey);
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString();

    const { data: keyRow, error: keyErr } = await admin.from('sqemes_api_keys').insert({
      workspace_id:          authCode.workspace_id,
      name:                  authCode.name || 'Claude Desktop',
      key_hash:              keyHash,
      key_prefix:            keyPrefix,
      scopes:                grantedScopes,
      expires_at:            accessExpiresAt,      // short-lived access token (enforced by mcp-server)
      connection_expires_at: connectionExpiresAt,  // displayed connection lifetime (Integrations tab)
      is_oauth:              true,                 // distinguishes OAuth connections in the UI
    }).select('id').single();

    if (keyErr || !keyRow) {
      return json({ error: 'server_error', error_description: 'Failed to issue access token' }, 500);
    }

    // Issue a refresh token bound to the connection (rotated on each use; revoked by
    // cascade when the connection is deleted in the Integrations tab).
    const refreshToken     = `sqm_refresh_${randomHex(32)}`;
    const refreshTokenHash = await hashKey(refreshToken);
    const { error: refreshErr } = await admin.from('mcp_refresh_tokens').insert({
      token_hash:   refreshTokenHash,
      key_id:       keyRow.id,
      workspace_id: authCode.workspace_id,
      scopes:       grantedScopes,
      expires_at:   connectionExpiresAt, // connection lifetime; null = never
    });

    if (refreshErr) {
      return json({ error: 'server_error', error_description: 'Failed to issue refresh token' }, 500);
    }

    return json({
      access_token:  rawKey,
      refresh_token: refreshToken,
      token_type:    'bearer',
      expires_in:    ACCESS_TTL_SECONDS,
      scope:         grantedScopes.join(' '),
    });
  }

  return json({ error: 'not_found' }, 404);
});
