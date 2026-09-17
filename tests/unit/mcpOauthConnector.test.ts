import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWwwAuthenticate } from '../../supabase/functions/_shared/wwwAuthenticate';

/**
 * SQEM-426 — an MCP server that hands out its own OAuth client. Read as source: these are Deno edge
 * functions, and what matters here is the shape of the flow, not its runtime.
 *
 * ⛔ The rules below are the ones that cost a working connector if somebody "tidies" them away.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const OAUTH = read('supabase/functions/_shared/mcpOauth.ts');
const WWWAUTH = read('supabase/functions/_shared/wwwAuthenticate.ts');
const START = read('supabase/functions/connector-oauth-start/index.ts');
const CALLBACK = read('supabase/functions/connector-oauth-callback/index.ts');
const TOKEN = read('supabase/functions/_shared/connectorToken.ts');
const APPS = read('supabase/functions/_shared/connectorApps.ts');

/**
 * SQEM-429 — the header the server sends, parsed from the three real ones. These strings are
 * **measured**, copied from `curl -D -` on 2026-09-17, not invented: the whole point of the ticket is
 * that the three servers disagree in ways nobody would think to make up.
 */
describe('SQEM-429 — WWW-Authenticate', () => {
  const NIFTY = 'Bearer realm="nifty-mcp", error="invalid_request", error_description="Authorization header is required. Send \\"Authorization: Bearer <nft_agent_*|nft_user_*>\\". Generate a key at https://app.nifty.pm/settings/mcp-keys.", resource_metadata="https://mcp.niftypm.com/.well-known/oauth-protected-resource"';
  const MICROSOFT = 'Bearer realm="", authorization_uri="https://login.microsoftonline.com/common/oauth2/authorize", client_id="e8c77dc2-69b3-43f4-bc51-3213c9d915b4", resource_metadata="https://mcp.svc.cloud.microsoft/.well-known/oauth-protected-resource/enterprise"';
  const PLAUD = 'Bearer error="invalid_token", error_description="Missing Authorization header", resource_metadata="https://mcp.plaud.ai/.well-known/oauth-protected-resource/mcp"';

  it('⛔ survives ESCAPED QUOTES inside a value — Nifty puts them in the middle', () => {
    // A `[^"]*` parser stops inside `error_description` and loses everything after it, including the
    // one field the flow needs. This exact header is why the body pattern is `(?:[^"\\]|\\.)*`.
    const p = parseWwwAuthenticate(NIFTY);
    expect(p.resource_metadata).toBe('https://mcp.niftypm.com/.well-known/oauth-protected-resource');
    expect(p.error_description).toContain('"Authorization: Bearer <nft_agent_*|nft_user_*>"');
  });

  it('⭐ reads the client_id a server advertises — Microsoft names its own', () => {
    const p = parseWwwAuthenticate(MICROSOFT);
    expect(p.client_id).toBe('e8c77dc2-69b3-43f4-bc51-3213c9d915b4');
    expect(p.resource_metadata).toBe('https://mcp.svc.cloud.microsoft/.well-known/oauth-protected-resource/enterprise');
  });

  it('the three servers name three DIFFERENT shapes — which is the whole bug', () => {
    // Plaud appends the path, Nifty appends nothing, Microsoft appends its own. Constructing one
    // shape can only ever be right for some of them.
    expect(parseWwwAuthenticate(PLAUD).resource_metadata).toMatch(/oauth-protected-resource\/mcp$/);
    expect(parseWwwAuthenticate(NIFTY).resource_metadata).toMatch(/oauth-protected-resource$/);
    expect(parseWwwAuthenticate(MICROSOFT).resource_metadata).toMatch(/oauth-protected-resource\/enterprise$/);
  });

  it('a header with nothing quoted yields nothing, rather than throwing', () => {
    expect(parseWwwAuthenticate('Bearer')).toEqual({});
    expect(parseWwwAuthenticate('')).toEqual({});
  });

  it('⛔ the parser module stays import-free — that is the only reason it is its own file', () => {
    // It lived in `mcpOauth.ts`, which imports `crypto.ts` and reads the environment through the Deno
    // runtime. Importing that from here pulled that global into the TypeScript program and broke
    // `tsc --noEmit` on a file nobody had touched. Move the parser back and this test says why not to.
    expect(WWWAUTH).not.toMatch(/^\s*import\s/m);
    // ⚠️ Usage, not the word — the comment above it explains the rule and has to name the runtime.
    expect(WWWAUTH).not.toMatch(/\bDeno\s*\./);
  });

  it('⛔ the probe is a POST, because a GET loses the header at Plaud', () => {
    // Measured: Plaud answers GET with 404 and only sends WWW-Authenticate on the JSON-RPC POST.
    // A GET probe would fall back to the constructed path — which is right for Plaud, so the bug
    // would stay invisible. Do not "simplify" this to a GET.
    const fn = OAUTH.slice(OAUTH.indexOf('export async function probeResourceMetadata'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/method: 'POST'/);
    expect(body).toMatch(/method: 'initialize'/);
    expect(body).toMatch(/headers\.get\('www-authenticate'\)/);
  });

  it('⛔ the header wins; the constructed paths are only a fallback — and there are TWO', () => {
    expect(OAUTH).toMatch(/const candidates = probe\.metadataUrl \? \[probe\.metadataUrl\] : \[/);
    // Both shapes, because the servers that need a fallback disagree about the suffix.
    expect(OAUTH).toMatch(/oauth-protected-resource\$\{path \? '\/' \+ path : ''\}/);
    expect(OAUTH).toMatch(/oauth-protected-resource`,\n\s*\];/);
  });

  it('⚠️ a failed discovery names every URL it tried', () => {
    // "404" alone is indistinguishable from "this server does not do OAuth" — the misreading that
    // cost SQEM-426 a round.
    expect(OAUTH).toMatch(/tried: \$\{tried\.join/);
  });

  it('the advertised client id is carried out of discovery, not dropped', () => {
    expect(OAUTH).toMatch(/advertisedClientId: probe\.clientId/);
  });
});

describe('SQEM-426 — MCP OAuth', () => {
  it('the well-known path goes after the ORIGIN, not after the path', () => {
    // Appending produces a 404 that reads like "this server has no OAuth" — the mistake that broke
    // third-party clients against our own server in SQEM-347.
    expect(OAUTH).toMatch(/\$\{u\.origin\}\/\.well-known\/oauth-protected-resource/);
    expect(OAUTH).not.toMatch(/mcpUrl\s*\+\s*['"]\/\.well-known/);
  });

  it('⛔ PKCE is S256 and the verifier travels in the encrypted state — nowhere else', () => {
    expect(OAUTH).toMatch(/digest\('SHA-256'/);
    expect(START).toMatch(/code_challenge_method', 'S256'/);
    // In `state`, which is already encrypted and time-boxed. Not a table, not a cookie.
    expect(START).toMatch(/k: 'mcp', v: verifier/);
    expect(CALLBACK).toMatch(/code_verifier: payload\.v!/);
  });

  it('⛔ a public client must not send a secret, and a confidential one must', () => {
    expect(OAUTH).toMatch(/token_endpoint_auth_method: 'none'/);
    for (const src of [CALLBACK, TOKEN]) {
      expect(src).toMatch(/if \(client\.clientSecret\) body\.set\('client_secret', client\.clientSecret\)/);
    }
  });

  it('⛔ the refresh path covers secretless clients — otherwise the connector dies after an hour', () => {
    // The env-configured branch below demands cfg.clientSecret, which a public client never has.
    expect(TOKEN).toMatch(/MCP_OAUTH_PROVIDERS\.has\(row\.provider\)/);
    expect(TOKEN).toMatch(/refreshMcpOauth\(admin, row\)/);
    // ⚠️ And it must run BEFORE the env path, so Google/Microsoft behave exactly as before.
    expect(TOKEN.indexOf('MCP_OAUTH_PROVIDERS.has')).toBeLessThan(TOKEN.indexOf('const cfg = row.provider ? REFRESH'));
  });

  it('⚠️ a rotated refresh token is persisted, or the NEXT refresh fails', () => {
    expect(TOKEN).toMatch(/if \(tok\.refresh_token\) update\.refresh_token_encrypted/);
  });

  it('⛔ re-registration happens once, and only for invalid_client', () => {
    expect(CALLBACK).toMatch(/=== 'invalid_client'/);
    expect(CALLBACK).toMatch(/exchange\(true\)/);
    expect(OAUTH).toMatch(/opts\.forceNew/);
  });

  it('a stored client registered for a different redirect URI is not reused', () => {
    expect(OAUTH).toMatch(/data\.redirect_uri === redirectUri/);
  });

  it('⛔ SQEM-430/447 — three sources, and CONFIGURED comes before the stored row', () => {
    // If the stored row won, changing the configured value would have no effect: a row already exists
    // for that issuer and step 2 would keep returning it. A silently ignored configuration change is
    // the worst of the four failures available here.
    const fn = OAUTH.slice(OAUTH.indexOf('export async function getOrRegisterClient'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body.indexOf('opts.configuredClientId')).toBeLessThan(body.indexOf('mcp_oauth_clients'));
    // ⚠️ The property, not the wording: SQEM-439 let a configured client carry a SECRET too, so the
    // returned `clientSecret` is no longer always null. What must not change is that a configured id
    // returns immediately, before the stored row is consulted.
    expect(body).toMatch(/if \(opts\.configuredClientId\) return \{ clientId: opts\.configuredClientId, clientSecret: opts\.configuredClientSecret \?\? null \}/);
    // ⛔ SQEM-447 — there used to be a fourth source here, taken from the `WWW-Authenticate` header.
    // It names the RESOURCE, not a client: Microsoft answers `AADSTS90009: requesting a token for
    // itself`. The value must never be used as a client again.
    expect(body).not.toMatch(/clientId: meta\.advertisedClientId/);
  });

  it('⛔ …and ALL THREE call sites pass it — the refresh is the one that dies quietly', () => {
    // Without it in `connectorToken`, a connector with a configured client id works for exactly one
    // hour and then fails with a provider 401 and nothing else (the SQEM-347 class).
    // ⚠️ Checked as "the source reaches the call", not as a literal argument shape — SQEM-437 added a
    // second source (a client id entered per connection) and every one of these grew a spread. Pinning
    // the exact text made this test fail on a change that kept the property it exists to protect.
    expect(START).toMatch(/mcpClientIdSource\(mcpApp\)/);
    expect(CALLBACK).toMatch(/forceNew,\s*\n?\s*\.\.\.\(MCP_OAUTH_APPS\[payload\.a \?\? ''\] \? mcpClientIdSource\(mcpApp\) : \{\}\)/);
    expect(TOKEN).toMatch(/mcpClientIdSource\(app\)/);
    for (const src of [START, CALLBACK, TOKEN]) expect(src).toMatch(/getOrRegisterClient\(admin, meta, REDIRECT_URI/);
  });

  it('⚠️ declared-but-empty is named, not silently read as "no registration"', () => {
    // The SQEM-405 trap: defined and empty, with an error pointing somewhere else entirely.
    expect(APPS).toMatch(/configuredClientIdEnv: app\.clientIdEnv/);
    expect(OAUTH).toMatch(/is declared for this app but empty/);
    expect(OAUTH).toMatch(/and the server offers no registration_endpoint/);
  });

  it('the helper returns the OPTIONS SHAPE, so no call site renames anything', () => {
    // It first returned `{env, value}` and the spread silently produced neither option — a mismatch
    // TypeScript cannot catch through a spread into an optional-only object.
    expect(APPS).toMatch(/function mcpClientIdSource\(app: McpOauthApp\): \{ configuredClientId\?: string; configuredClientIdEnv\?: string \}/);
  });

  it('the providers that refresh this way come from the registry, not a second list', () => {
    expect(TOKEN).toMatch(/Object\.values\(MCP_OAUTH_APPS\)\.map\(\(a\) => a\.provider\)/);
    expect(APPS).toMatch(/plaud: \{ provider: 'plaud', name: 'Plaud', mcpUrl: 'https:\/\/mcp\.plaud\.ai\/mcp' \}/);
  });

  it('⚠️ the resource parameter is sent — audience-bound servers refuse without it', () => {
    // ⛔ SQEM-449 — and it is the identifier the server DECLARES, not the endpoint we call. Nifty
    // publishes `https://mcp.niftypm.com` for an endpoint at `…/mcp`, and sending the endpoint gets
    // `invalid_target: unknown resource`. Three of four servers declare exactly their endpoint, which
    // is why constructing it worked for so long — the same coincidence that hid SQEM-429.
    expect(START).toMatch(/searchParams\.set\('resource', meta\.resource \?\? mcpTarget\.mcpUrl\)/);
    expect(CALLBACK).toMatch(/resource: meta\.resource \?\? mcpApp\.mcpUrl/);
    // ⚠️ The refresh sends the same identifier, or the connector lasts exactly one hour.
    expect(TOKEN).toMatch(/resource: meta\.resource \?\? mcpUrl/);
    expect(OAUTH).toMatch(/resource: typeof prm\.resource === 'string' \? prm\.resource : undefined/);
  });
});
