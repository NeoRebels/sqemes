// SQEM-426 — connecting to an MCP server that authenticates with OAuth, without anybody having
// registered a client by hand.
//
// **The difference to `PROVIDERS` in `connectorApps.ts`, in one sentence:** there the client id and
// secret are ours and sit in env vars; here the server hands us a client when we ask for one, at
// runtime, and we have to remember it (`mcp_oauth_clients`).
//
// The flow this module implements, in the order the spec walks it:
//   1. The MCP endpoint answers an unauthenticated call with `401` and a `WWW-Authenticate` header
//      naming its **protected-resource metadata** (RFC 9728).
//   2. That metadata names one or more **authorization servers**.
//   3. The authorization server's metadata (RFC 8414) gives `authorization_endpoint`, `token_endpoint`
//      and — if it supports it — `registration_endpoint` (RFC 7591).
//   4. We register once, keep the client, and run a normal authorization-code flow with **PKCE**.
//
// ⛔ **Step 1 was skipped until SQEM-429, and that was the bug.** The reasoning on record — "we
// already know the resource URL, so asking the endpoint tells us something we configured ourselves"
// — confuses two different things. We know the *resource* URL; the header names the *metadata* URL,
// and the two are not derivable from one another. Measured 2026-09-17:
//
//   Plaud      →  …/.well-known/oauth-protected-resource/mcp          (path appended)
//   Nifty      →  …/.well-known/oauth-protected-resource               (no path at all)
//   Microsoft  →  …/.well-known/oauth-protected-resource/enterprise   (path appended)
//
// Constructing it worked for Plaud by coincidence and produced a bare 404 for Nifty — an error that
// reads like "this server has no OAuth". The header is asked for first now; the constructed paths
// remain as a fallback for servers that send no header at all.

import { encryptApiKey, decryptApiKey } from './crypto.ts';
import { parseWwwAuthenticate } from './wwwAuthenticate.ts';

export interface AuthServerMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  /** SQEM-444 — what the dialog offers, and what SQEM-439 proved must not be left out. */
  scopes_supported?: string[];
  /**
   * ⛔ SQEM-449 — the resource identifier the server DECLARES, which is what RFC 8707's `resource`
   * parameter must carry. It is not always the MCP URL: Nifty publishes `https://mcp.niftypm.com`
   * while its endpoint is `https://mcp.niftypm.com/mcp`, and sending the endpoint gets
   * `invalid_target: unknown resource`.
   *
   * ⚠️ Plaud, Noota and Notion declare exactly their endpoint — which is why constructing the value
   * worked for three servers out of four and hid the bug. The same coincidence hid SQEM-429.
   */
  resource?: string;
  /**
   * The `client_id` some servers put in their own `WWW-Authenticate` header.
   *
   * ⛔ **SQEM-447 — this is NOT a client we may use, and SQEM-430 wrongly treated it as one.** It
   * names the resource: Microsoft's value carries the same GUID as the scope it asks for, and using
   * it as the client produces `AADSTS90009: requesting a token for itself`. RFC 9728 does not define
   * the field. Kept only so the mistake stays visible rather than being re-derived from the header by
   * the next person who sees it there.
   */
  advertisedClientId?: string;
}

/**
 * Ask the MCP endpoint itself where its metadata lives (RFC 9728 step 1).
 *
 * ⛔ **It has to be the `initialize` POST, not a GET.** Measured 2026-09-17: Plaud answers a bare
 * `GET` with **404** and only sends `WWW-Authenticate` on the JSON-RPC POST. A GET-based probe would
 * therefore lose the header exactly where the constructed fallback happens to be right — the failure
 * would stay invisible until a server needed both, which is how this bug survived SQEM-426.
 *
 * Never throws: a server that answers 200, times out, or sends no header simply yields `{}`, and the
 * caller falls back to the constructed paths.
 */
export async function probeResourceMetadata(mcpUrl: string): Promise<{ metadataUrl?: string; clientId?: string }> {
  let header: string | null = null;
  try {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sqemes', version: '1' } },
      }),
    });
    header = res.headers.get('www-authenticate');
  } catch (e) {
    console.warn('[mcp-oauth] probe failed, falling back to constructed paths:', String(e).slice(0, 200));
    return {};
  }
  if (!header) return {};
  const params = parseWwwAuthenticate(header);
  return { metadataUrl: params.resource_metadata, clientId: params.client_id };
}

export interface RegisteredClient {
  clientId: string;
  clientSecret: string | null;
}

/** Fetch JSON, or throw with a message that names the URL — a 404 here is otherwise anonymous. */
async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.json();
}

/**
 * Find the authorization server for an MCP resource URL.
 *
 * The order is the spec's: **ask the resource first** (SQEM-429), and only construct a path when it
 * says nothing. Both constructed shapes are tried, because the two servers that need a fallback
 * disagree about the suffix.
 *
 * ⚠️ **The well-known segment goes after the ORIGIN either way, never appended to the path** — for
 * `https://host/mcp` it is `https://host/.well-known/oauth-protected-resource/mcp`, never
 * `https://host/mcp/.well-known/…`. That is the mistake that made several clients fail against our
 * OWN server in SQEM-347, and it produces the same anonymous 404.
 */
export async function discoverAuthServer(mcpUrl: string): Promise<AuthServerMeta> {
  const u = new URL(mcpUrl);
  const path = u.pathname.replace(/^\/+/, '');
  const probe = await probeResourceMetadata(mcpUrl);

  const candidates = probe.metadataUrl ? [probe.metadataUrl] : [
    `${u.origin}/.well-known/oauth-protected-resource${path ? '/' + path : ''}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ];
  let prm: Record<string, unknown> | null = null;
  const tried: string[] = [];
  for (const candidate of candidates) {
    try { prm = await getJson(candidate); break; } catch (e) { tried.push(String(e)); }
  }
  // ⚠️ Name every URL that was tried. A single "404" here is the least actionable error in the whole
  // flow — it is indistinguishable from "this server does not do OAuth".
  if (!prm) throw new Error(`no protected-resource metadata for ${mcpUrl} (tried: ${tried.join(' · ')})`);

  const servers = Array.isArray(prm.authorization_servers) ? prm.authorization_servers as string[] : [];
  const issuerUrl = (servers[0] ?? u.origin).replace(/\/+$/, '');

  // RFC 8414 puts the well-known segment after the origin too; plenty of servers also answer the
  // OpenID-style path, so try both before giving up.
  let meta: Record<string, unknown> | null = null;
  for (const candidate of [
    `${issuerUrl}/.well-known/oauth-authorization-server`,
    `${issuerUrl}/.well-known/openid-configuration`,
  ]) {
    try { meta = await getJson(candidate); break; } catch { /* try the next */ }
  }
  if (!meta) throw new Error(`no authorization-server metadata under ${issuerUrl}`);

  const out: AuthServerMeta = {
    issuer: String(meta.issuer ?? issuerUrl),
    authorization_endpoint: String(meta.authorization_endpoint ?? ''),
    token_endpoint: String(meta.token_endpoint ?? ''),
    registration_endpoint: meta.registration_endpoint ? String(meta.registration_endpoint) : undefined,
    code_challenge_methods_supported: meta.code_challenge_methods_supported as string[] | undefined,
    token_endpoint_auth_methods_supported: meta.token_endpoint_auth_methods_supported as string[] | undefined,
    scopes_supported: meta.scopes_supported as string[] | undefined,
    resource: typeof prm.resource === 'string' ? prm.resource : undefined,
    advertisedClientId: probe.clientId,
  };
  if (!out.authorization_endpoint || !out.token_endpoint) {
    throw new Error(`incomplete metadata at ${out.issuer} (no authorization_endpoint/token_endpoint)`);
  }
  return out;
}

/**
 * The client we use at this authorization server. **SQEM-430 — there are four ways to have one**, and
 * the order below is the decision, not an accident:
 *
 *   1. **Configured** (`opts.configuredClientId`, from the app's `clientIdEnv`). An explicit setting
 *      wins over everything, including a client we registered earlier — otherwise changing the value
 *      would have no effect, because `mcp_oauth_clients` already holds a row for that issuer and step
 *      2 would keep returning it. A silently ignored configuration change is the worst of the four
 *      possible failures here.
 *   2. **Stored** — what we registered at this issuer before.
 *   3. **Registered** (RFC 7591), when the server offers it. Plaud and Notion do.
 *   4. **Advertised** — the `client_id` the resource named in its own `WWW-Authenticate` header
 *      (SQEM-429). Microsoft's enterprise MCP does; it needs no configuration at all.
 *
 * ⚠️ **Why registration ranks above the advertised id, given both would work:** registering gives us
 * our own identity, so the consent screen says "sqemes" rather than the vendor's own client name. No
 * measured server offers both, so today the order changes nothing — it is written down so that
 * reversing it is a decision somebody makes knowingly.
 *
 * ⚠️ **`forceNew` exists because a registration can die.** A server may expire or revoke clients, and
 * the only symptom is a token endpoint that starts answering `invalid_client` — which reads exactly
 * like a user problem. The caller retries once with `forceNew: true` instead of leaving a connector
 * permanently broken. It skips steps 1–2 only in as far as the *stored* row is concerned: a
 * configured id is not something a retry can improve on.
 */
export async function getOrRegisterClient(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  meta: AuthServerMeta,
  redirectUri: string,
  opts: { forceNew?: boolean; configuredClientId?: string; configuredClientSecret?: string; configuredClientIdEnv?: string } = {},
): Promise<RegisteredClient> {
  // 1. Configured — a deliberate setting, so it outranks anything we discovered or stored.
  // SQEM-439 — a configured client MAY carry a secret: some providers (Nifty's App Center) hand out
  // both, and their token endpoint then expects `client_secret_post`. Null stays the default, which
  // is what a public client with PKCE needs.
  if (opts.configuredClientId) return { clientId: opts.configuredClientId, clientSecret: opts.configuredClientSecret ?? null };

  if (!opts.forceNew) {
    const { data } = await admin.from('mcp_oauth_clients')
      .select('client_id, client_secret_encrypted, redirect_uri')
      .eq('issuer', meta.issuer).maybeSingle();
    // ⚠️ A stored client registered against a DIFFERENT redirect URI is useless: the provider rejects
    // the exchange, and the error names the token endpoint rather than the URI. Re-register instead.
    if (data?.client_id && data.redirect_uri === redirectUri) {
      return {
        clientId: data.client_id,
        clientSecret: data.client_secret_encrypted ? await decryptApiKey(data.client_secret_encrypted) : null,
      };
    }
  }

  // 3. Register if we may.
  //
  // ⛔ **SQEM-447 — there used to be a step 4 here, and it was built on a misreading.** SQEM-430 took
  // the `client_id` in Microsoft's `WWW-Authenticate` to mean "the server telling us who to present
  // ourselves as" and used it as a client. It names the RESOURCE — which is why its scope carries the
  // very same GUID — and Microsoft rejects the combination outright:
  //
  //   AADSTS90009: Application 'e8c77dc2-…' is requesting a token for itself.
  //
  // RFC 9728 does not define `client_id` in this header at all. One measurement was generalised into
  // a mechanism, and the meaning was guessed. The header is still read (SQEM-429 needs
  // `resource_metadata` from it); the value is no longer treated as a client.
  if (!meta.registration_endpoint) {
    // ⚠️ Name every route that was not available, and name the env var by its real name — "this
    // server offers no dynamic client registration" points at the server when the actual problem is
    // usually an empty variable on our side.
    const configured = opts.configuredClientIdEnv
      ? `${opts.configuredClientIdEnv} is declared for this app but empty`
      : 'no client id was configured or entered for this connector';
    throw new Error(
      `${meta.issuer}: no client available — ${configured}, and the server offers no registration_endpoint`,
    );
  }

  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'sqemes',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // We hold no secret in the browser and run the exchange server-side; `none` + PKCE is the
      // combination MCP servers expect. A server that insists on a secret returns one anyway.
      token_endpoint_auth_method: 'none',
      application_type: 'web',
    }),
  });
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !body.client_id) {
    throw new Error(`registration at ${meta.registration_endpoint} failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }

  const clientId = String(body.client_id);
  const clientSecret = body.client_secret ? String(body.client_secret) : null;
  await admin.from('mcp_oauth_clients').upsert({
    issuer: meta.issuer,
    client_id: clientId,
    client_secret_encrypted: clientSecret ? await encryptApiKey(clientSecret) : null,
    redirect_uri: redirectUri,
    registration: body,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'issuer' });

  return { clientId, clientSecret };
}

/**
 * A PKCE pair. ⛔ S256 only — `plain` is in the spec and is worthless: it puts the verifier in the
 * authorization request, which is the thing PKCE exists to keep out of it.
 */
export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
