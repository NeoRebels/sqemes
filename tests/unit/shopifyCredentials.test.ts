import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shopFromMcpUrl } from '../../supabase/functions/_shared/shopifyToken';

/**
 * SQEM-469 — Shopify mints a token that dies after 24 hours.
 *
 * ⛔ **Measured live with a customer on 2026-09-25.** Shopify removed legacy custom apps on
 * 2026-01-01; an app created since hands out a client id and secret, and the exchange answers
 * `{"access_token":"shpat_…","scope":"read_products,…","expires_in":86399}`. Our tile was a paste
 * field for a durable token, so a connection set up on Monday was dead on Tuesday.
 *
 * ⚠️ The two failure modes that look alike, both hit during that call:
 *   `400 app_not_installed`  — the app exists but is not installed on the store
 *   `200` with `"scope": ""` — installed without approved scopes; the token authenticates and every
 *                              data call answers `403 requires merchant approval`
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// ⚠️ Line comments BEFORE block comments — same stripper as `assistantsBecomeSkills.test.ts`.
// Needed here for the usual reason: the docblocks under test quote the phrases asserted absent.
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-469 — the shop comes out of the connector URL', () => {
  it('reads the ?shop= parameter', () => {
    expect(shopFromMcpUrl('https://api.sqemes.com/functions/v1/mcp-shopify?shop=arktisbiopharma.myshopify.com'))
      .toBe('arktisbiopharma.myshopify.com');
  });

  it('⚠️ refuses anything that is not a myshopify domain', () => {
    // The exchange posts to this host. A value from elsewhere would send the client secret there.
    expect(shopFromMcpUrl('https://x/functions/v1/mcp-shopify?shop=evil.example.com')).toBeNull();
    expect(shopFromMcpUrl('https://x/functions/v1/mcp-shopify')).toBeNull();
    expect(shopFromMcpUrl(null)).toBeNull();
  });
});

describe('SQEM-469 — an empty scope is a failure, not a success', () => {
  it('⛔ the exchange rejects a token that may read nothing', () => {
    const s = read('supabase/functions/_shared/shopifyToken.ts');
    expect(s).toMatch(/if \(!tok\.scope\)/);
    // The message has to name the order, because the wrong order is what produces this state.
    expect(s).toMatch(/publish it[\s\S]{0,80}install the app on the store/);
  });

  it("⛔ Shopify's own words survive — no invented 'connection failed'", () => {
    const s = read('supabase/functions/_shared/shopifyToken.ts');
    expect(s).toMatch(/app_not_installed/);
    expect(code(s).toLowerCase()).not.toMatch(/connection failed/);
  });
});

describe('SQEM-469 — connectors from before 2026 must not change', () => {
  it('⛔ the refresh branch requires the credentials, not just the provider', () => {
    // A legacy `shpat_` never expires and carries no client id. Gating on `provider === "shopify"`
    // alone would send those down a path they cannot complete — and break paying customers who did
    // nothing wrong. This is the assertion that protects them.
    const s = read('supabase/functions/_shared/connectorToken.ts');
    expect(s).toMatch(/row\.provider === 'shopify' && row\.oauth_client_id && row\.oauth_client_secret_encrypted/);
  });

  it('the credentials are stored so the token can be minted again', () => {
    const s = read('supabase/functions/manage-connectors/index.ts');
    expect(s).toMatch(/oauth_client_id: storedTokenClientId/);
    expect(s).toMatch(/oauth_client_secret_encrypted: await encryptApiKey/);
    expect(s).toMatch(/token_expires_at: tokenExpiresAt/);
  });
});

describe('SQEM-469 — the help text no longer describes a path Shopify closed', () => {
  it('⛔ "Develop apps" is gone', () => {
    const s = read('components/ConnectorsCard.tsx');
    const tile = s.slice(s.indexOf("id: 'shopify',"), s.indexOf("id: 'shopify-storefront'"));
    expect(code(tile)).not.toMatch(/Develop apps/);
    expect(tile).toMatch(/Dev Dashboard/);
    expect(tile).toMatch(/THEN install the app/);
  });
});
