import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-444 — any MCP server, not only the ones we shipped a tile for.
 *
 * ⛔ The gap this closes: SQEM-426/429/430/437/439/441 built four ways to authenticate, and **every
 * one of them was reachable only through a pre-built tile.** The mechanics were general; the way in
 * was not. The dialog now asks the server which shape it is and shows only the fields that shape
 * needs.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const FN = read('supabase/functions/manage-connectors/index.ts');
const START = read('supabase/functions/connector-oauth-start/index.ts');
const CALLBACK = read('supabase/functions/connector-oauth-callback/index.ts');
const TOKEN = read('supabase/functions/_shared/connectorToken.ts');
const CARD = read('components/ConnectorsCard.tsx');

describe('SQEM-444 — the dialog asks the server', () => {
  it('⛔ inspect distinguishes all four shapes', () => {
    const fn = FN.slice(FN.indexOf("body.action === 'inspect'"));
    const body = fn.slice(0, fn.indexOf('\n    /**'));
    expect(body).toMatch(/kind: 'none'/);
    expect(body).toMatch(/kind: 'oauth'/);
    expect(body).toMatch(/kind: 'token'/);
    expect(body).toMatch(/registration: !!meta\.registration_endpoint/);
    // ⛔ SQEM-447 removed a fifth branch here: the header's `client_id` names the RESOURCE, not a
    // client we may use. It is not reported, so the dialog cannot offer it.
    expect(body).not.toMatch(/advertisedClientId/);
    // ⚠️ Scopes are returned — leaving them out cost SQEM-439 a whole round.
    expect(body).toMatch(/scopes: meta\.scopes_supported \?\? \[\]/);
  });

  it('⛔ the refresh works for a connector that is in no registry', () => {
    // The trap this function has now come close to three times: without 'mcp' in the set, an ad-hoc
    // connector falls through to the env branch, finds no client, and dies about an hour after setup
    // with a provider 401 as its only symptom.
    expect(TOKEN).toMatch(/'mcp',\n\]\);/);
    expect(TOKEN).toMatch(/const mcpUrl = app\?\.mcpUrl \?\? row\.mcp_url \?\? ''/);
    expect(TOKEN).toMatch(/discoverAuthServer\(mcpUrl\)/);
  });

  it('the ad-hoc target travels through start, state and callback', () => {
    expect(START).toMatch(/mcpUrl: adHocUrl, name: adHocName, scopes: adHocScopes/);
    expect(START).toMatch(/\.\.\.\(mcpApp \? \{\} : \{ m: mcpTarget\.mcpUrl, n: mcpTarget\.name \}\)/);
    expect(CALLBACK).toMatch(/payload\.m && payload\.n/);
  });

  it('⚠️ the ad-hoc URL is validated the way the storefront host is', () => {
    // Our own function fetches this during discovery. https, a hostname, not an IP — the same surface
    // the manual connector has had since SQEM-149, no wider.
    expect(START).toMatch(/u\.protocol !== 'https:'/);
    expect(START).toMatch(/\^\\d\+\(\\\.\\d\+\)\{3\}\$/);
    expect(START).toMatch(/!u\.hostname\.includes\('\.'\)/);
  });

  it('⛔ the dialog shows only what the shape needs', () => {
    // The token field used to be unconditional, which offered the least common of the four shapes as
    // the default.
    expect(CARD).toMatch(/\{inspected\?\.kind === 'token' && \(/);
    expect(CARD).toMatch(/\{inspected\?\.kind === 'oauth' && \(/);
    expect(CARD).toMatch(/\{inspected\?\.kind === 'none' && \(/);
    // …and the redirect URI appears only where a client has to be registered by hand.
    // The rule, not the distance between two strings: a server that registers its own client says so,
    // and only the other branch asks for anything.
    expect(CARD).toMatch(/this server issues its own credentials/);
    expect(CARD).toMatch(/Redirect URI — register this in/);
  });

  it('⛔ an OAuth server is connected, not added — two endings, two buttons', () => {
    expect(CARD).toMatch(/inspected\?\.kind === 'oauth' \? \(/);
    expect(CARD).toMatch(/onClick=\{connectAdHoc\}/);
    // The plain add stays disabled until the server has been checked.
    expect(CARD).toMatch(/disabled=\{saving \|\| !inspected \|\| !name\.trim\(\)/);
  });
});
