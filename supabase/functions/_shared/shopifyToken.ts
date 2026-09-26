// SQEM-469 — Shopify's client credentials grant.
//
// ⛔ **Shopify removed legacy custom apps on 2026-01-01.** An app created since then hands out a
// Client ID and a Client Secret, never a durable `shpat_` token: you exchange them for an access
// token that **expires after 24 hours** (`expires_in: 86399`). Our tile was a paste field for a
// static token, so a connection set up on Monday was dead on Tuesday — measured live with a
// customer on 2026-09-25.
//
// ⭐ **This is NOT the refresh-token shape.** The two existing branches in `connectorToken.ts` both
// require `refresh_token_encrypted`, and this grant issues none: the credentials themselves are the
// long-lived secret, and a new token is minted from them each time. That is why it needs its own
// path rather than another entry in the `REFRESH` map.
//
// ⚠️ **Two failure modes that look alike and both happened during that call:**
//   `400 app_not_installed`  — the app exists but is not installed on the store.
//   `200` with `"scope": ""` — installed, but no access scopes were approved. The token then
//                              authenticates perfectly and every data call answers
//                              `403 requires merchant approval`. An empty scope is therefore a
//                              FAILURE, and this module treats it as one: a token that may read
//                              nothing is not a connection, and letting it through would reproduce
//                              exactly the "connected but dead" state SQEM-467 exists to prevent.

export type ShopifyGrant = { accessToken: string; scope: string; expiresAt: string };

/** The store's myshopify domain, which rides on the connector's `mcp_url` as `?shop=`. */
export function shopFromMcpUrl(mcpUrl: string | null | undefined): string | null {
  if (!mcpUrl) return null;
  try {
    const shop = new URL(mcpUrl).searchParams.get('shop');
    return shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? shop : null;
  } catch { return null; }
}

/**
 * Exchange Client ID + Secret for an access token. Throws with Shopify's own words on failure —
 * never a generic "connection failed" (`lib/aiErrors.ts` in the source repository argues why).
 */
export async function fetchShopifyToken(
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<ShopifyGrant> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });

  const body = await res.text();
  if (!res.ok) {
    // ⚠️ Shopify answers `app_not_installed` as an HTML error page, not JSON — so the status and a
    // short excerpt are more useful here than a parse attempt that would throw on its own.
    const hint = /app_not_installed/i.test(body)
      ? 'the app is not installed on this store'
      : body.slice(0, 200).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`Shopify refused the credentials (HTTP ${res.status}): ${hint}`);
  }

  let tok: { access_token?: string; scope?: string; expires_in?: number };
  try { tok = JSON.parse(body); } catch { throw new Error('Shopify returned a response we could not read'); }
  if (!tok.access_token) throw new Error('Shopify returned no access token');

  if (!tok.scope) {
    throw new Error(
      'the app has no approved access scopes, so the token may not read anything. '
      + 'Set read_products, read_orders and read_customers on the app version, publish it, '
      + 'then install the app on the store — in that order.',
    );
  }

  return {
    accessToken: tok.access_token,
    scope: tok.scope,
    // ⚠️ A minute of slack: the caller treats "expires within a minute" as expired, and a token
    // handed over at the very edge of its life would otherwise be refreshed on its first use.
    expiresAt: new Date(Date.now() + ((tok.expires_in ?? 86_400) * 1000)).toISOString(),
  };
}
