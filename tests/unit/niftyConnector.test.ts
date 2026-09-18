import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-437 — Nifty: the third way an MCP server tells us which client to be.
 *
 * Registered (Plaud, Notion) · advertised in the server's own 401 header (Microsoft) · **entered by
 * the person** (Nifty, one id per user from their MCP settings). Only the third needs storage, and
 * only because of the refresh.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const APPS = read('supabase/functions/_shared/connectorApps.ts');
const START = read('supabase/functions/connector-oauth-start/index.ts');
const CALLBACK = read('supabase/functions/connector-oauth-callback/index.ts');
const TOKEN = read('supabase/functions/_shared/connectorToken.ts');
const CHAT = read('supabase/functions/chat-message/index.ts');
const MANAGE = read('supabase/functions/manage-connectors/index.ts');
const SQL = read('supabase/migrations/20260917160000_sqem437_connector_oauth_client_id.sql');
const CARD = read('components/ConnectorsCard.tsx');
const API = read('lib/api/connectors.ts');

describe('SQEM-437 — Nifty connector', () => {
  it('⛔ Nifty declares scopes — without them the consent screen rejects the request', () => {
    // Measured 2026-09-17: the authorization endpoint accepts a request with no `scope` and forwards
    // it to the consent UI, which then has nothing to ask about and answers "this connection request
    // is invalid or expired" — an error that names neither the parameter nor the cause. `state` and
    // `resource` both survive the same hop, so neither of those was it.
    expect(APPS).toMatch(/mcpUrl: 'https:\/\/mcp\.niftypm\.com\/mcp', scopes: \['read', 'write'\]/);
    // ⚠️ `delete` is left out on purpose — a granted scope is not something `allowed_tools` can take
    // back, and deletion is the one mistake that cannot be undone.
    expect(APPS).not.toMatch(/scopes: \['read', 'write', 'delete'\]/);
    // …and the start function has to actually send them.
    // ⚠️ `mcpTarget` since SQEM-444 — same value, now also covering a server added by hand.
    expect(START).toMatch(/if \(mcpTarget\.scopes\?\.length\) authUrl\.searchParams\.set\('scope', mcpTarget\.scopes\.join\(' '\)\)/);
  });

  it('Nifty is an MCP-OAuth app with NO configured client id', () => {
    expect(APPS).toMatch(/nifty: \{ provider: 'nifty', name: 'Nifty', mcpUrl: 'https:\/\/mcp\.niftypm\.com\/mcp'/);
    // No `clientIdEnv`: the id is per user, not per installation.
    expect(APPS).not.toMatch(/nifty:[^}]*clientIdEnv/);
  });

  it('⛔ the entered id survives all THREE moments', () => {
    // 1. the redirect — inside the encrypted state
    expect(START).toMatch(/\.\.\.\(entered \? \{ c: entered \} : \{\}\)/);
    // 2. the token exchange — read back out
    expect(CALLBACK).toMatch(/\.\.\.\(payload\.c \? \{ configuredClientId: payload\.c \} : \{\}\)/);
    // 3. the refresh — from the row, because the state is long gone by then
    expect(CALLBACK).toMatch(/\.\.\.\(payload\.c \? \{ oauth_client_id: payload\.c \} : \{\}\)/);
    expect(TOKEN).toMatch(/\.\.\.\(row\.oauth_client_id \? \{ configuredClientId: row\.oauth_client_id \} : \{\}\)/);
  });

  it('⛔ …and BOTH readers select the column, or the refresh silently uses the wrong client', () => {
    // `chat-message` and the `manage-connectors` probe each build their own row and both call
    // `getFreshConnectorToken`. A column missing from either select arrives as undefined, the refresh
    // falls back to a different client id, and the provider answers `invalid_client` for a connector
    // that is perfectly fine.
    for (const [name, src] of [['chat-message', CHAT], ['manage-connectors', MANAGE]] as const) {
      expect(src, name).toMatch(/token_expires_at, oauth_client_id[,']/);
    }
  });

  it('the state payload declares the field it carries', () => {
    expect(CALLBACK).toMatch(/i\?: string; c\?: string/);
  });

  it('⚠️ the pasted value is trimmed', () => {
    // Trailing whitespace produces a client_id the provider does not recognise, and nothing on our
    // side would say so (SQEM-273).
    expect(START).toMatch(/typeof enteredClientId === 'string' \? enteredClientId\.trim\(\) : ''/);
  });

  it('the tile asks for a Client ID and says where to find it', () => {
    expect(CARD).toMatch(/auth: 'oauth-id', Icon: NiftyIcon/);
    expect(CARD).toMatch(/tokenLabel: 'Client ID'/);
    // The signature grew an ad-hoc parameter in SQEM-444; what matters here is that a client id and
    // secret can still be handed to it.
    expect(API).toMatch(/clientId\?: string,\s*\n?\s*clientSecret\?: string,/);
  });

  it('⛔ SQEM-439 — it points at the App Center, NOT the MCP settings tab', () => {
    // The id in Nifty's MCP settings is registered for CLAUDE DESKTOP's redirect URI. Telling people
    // to paste that one is what made SQEM-437 fail in the owner's test: Nifty rejects the exchange,
    // and the error names the token endpoint rather than the URI.
    expect(CARD).toMatch(/open the App Center and create an OAuth app using the redirect URI shown above/);
    expect(CARD).not.toMatch(/Settings → MCP, copy the Client ID/);
  });

  it('⛔ the shown URI is normalised the SAME way the server normalises its own', () => {
    // Staging's VITE_SUPABASE_URL ends with a slash, so the unnormalised form produced
    // `…supabase.co//functions/v1/connector-oauth-callback` while the edge function sent the
    // single-slash one. An OAuth provider compares redirect URIs exactly: registering the shown value
    // then failed with "this connection request is invalid or expired", which names neither the URI
    // nor the slash. Both sides strip trailing slashes; neither may stop.
    // ⚠️ SQEM-456 MOVED this expression out of `lib/api/connectors.ts` into `lib/env.ts`, and the
    // rule is unchanged — the browser still strips exactly what the server strips. The assertion
    // follows the rule to its new home instead of pinning the old address: nineteen other call
    // sites had been appending to the raw variable precisely because the rule sat somewhere nobody
    // would import from.
    expect(read('lib/env.ts')).toMatch(/String\(import\.meta\.env\.VITE_SUPABASE_URL \?\? ''\)\.trim\(\)\.replace\(\/\\\/\+\$\/, ''\)/);
    expect(API).toMatch(/FUNCTIONS_BASE/);
    for (const src of [START, read('supabase/functions/_shared/connectorApps.ts')]) {
      expect(src).toMatch(/\.trim\(\)\.replace\(\/\\\/\+\$\/, ''\)/);
    }
  });

  it('⛔ …and the dialog SHOWS the redirect URI, because nothing else can', () => {
    expect(CARD).toMatch(/Redirect URI — register this in Nifty/);
    expect(CARD).toMatch(/connectorRedirectUri\(\)/);
    // ⚠️ It differs per environment, so a staging app is not a production app.
    expect(CARD).toMatch(/specific to this sqemes instance/);
  });

  it('⚠️ the optional Client Secret is masked, and the Client ID is not', () => {
    // One is a secret, the other is not — Microsoft publishes its own client id in a 401 header.
    expect(CARD).toMatch(/type=\{tokenApp\.auth === 'token' \? 'password' : 'text'\}/);
    expect(CARD).toMatch(/value=\{tokenSecret\}[\s\S]{0,120}type="password"/);
  });

  it('⛔ the secret survives the same three moments as the id', () => {
    expect(START).toMatch(/\.\.\.\(enteredSecret \? \{ s: enteredSecret \} : \{\}\)/);
    expect(CALLBACK).toMatch(/\.\.\.\(payload\.s \? \{ configuredClientSecret: payload\.s \} : \{\}\)/);
    expect(CALLBACK).toMatch(/oauth_client_secret_encrypted: await encryptApiKey\(payload\.s\)/);
    expect(TOKEN).toMatch(/configuredClientSecret: await decryptApiKey\(row\.oauth_client_secret_encrypted\)/);
    // …and both readers select it, same trap as the id.
    for (const src of [CHAT, MANAGE]) expect(src).toMatch(/oauth_client_id, oauth_client_secret_encrypted'/);
  });

  it('⚠️ the field is NOT masked — a client id is not a secret', () => {
    // Masking it would stop the person checking what they pasted, which is the one error this flow
    // cannot detect on our side.
    //
    // ⚠️ Asserted as the RULE, not the expression: this pinned
    // `auth === 'oauth-id' ? 'text' : 'password'` and went red when SQEM-441 added a fourth kind and
    // flipped the condition to key on 'token'. Behaviour unchanged, test wrong — the third time in
    // this chain that a wording pin cost a red run. What must hold is: only a TOKEN is masked.
    expect(CARD).toMatch(/type=\{tokenApp\.auth === 'token' \? 'password' : 'text'\}/);
  });

  it('⛔ no "share with the workspace" option — the callback always writes user_id', () => {
    // Offering a checkbox the backend ignores is worse than offering none.
    // The durable form: whatever else may share, `oauth-id` never appears in that condition.
    expect(CARD).toMatch(/\{canShare && \(tokenApp\.auth === 'token' \|\| tokenApp\.auth === 'public'\) && \(/);
    expect(CARD).not.toMatch(/canShare &&[^\n]*oauth-id/);
    expect(CALLBACK).toMatch(/user_id: payload\.u,/);
  });

  it('the column exists and explains why it is not just the state', () => {
    expect(SQL).toMatch(/add column if not exists oauth_client_id text/);
    expect(SQL).toMatch(/the `state` is long gone/);
  });
});
