import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-441 — the storefront side of a Shopify shop: catalogue, policies, cart.
 *
 * ⭐ A fourth connector shape, and the simplest one: **no credentials at all**. Measured 2026-09-17
 * against `www.allbirds.com` — `POST /api/mcp` with `tools/list` answers HTTP 200 and lists tools, no
 * auth header of any kind. It therefore works for shops nobody here owns, which is the point.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const CARD = read('components/ConnectorsCard.tsx');

describe('SQEM-441 — Shopify Storefront', () => {
  it('it is a separate tile, not a replacement for the admin connector', () => {
    // Two different capabilities: storefront sees the catalogue, admin sees orders and customers.
    expect(CARD).toMatch(/id: 'shopify-storefront', provider: 'shopify-storefront'/);
    expect(CARD).toMatch(/id: 'shopify', provider: 'shopify'/);
    expect(CARD).toMatch(/tokenLabel: 'Admin API access token'/);
  });

  it('⭐ it asks for a domain and nothing else', () => {
    expect(CARD).toMatch(/auth: 'public'/);
    expect(CARD).toMatch(/hostLabel: 'Store domain'/);
    expect(CARD).toMatch(/path: '\/api\/mcp'/);
    // No credential of any kind on this kind.
    expect(CARD).not.toMatch(/auth: 'public'[^}]*tokenLabel/);
  });

  it('⛔ the domain is NOT forced to *.myshopify.com', () => {
    // The admin connector checks for it; a storefront almost always runs on the shop's own domain
    // (allbirds.com), so that rule would reject exactly the cases this tile exists for.
    const fn = CARD.slice(CARD.indexOf("if (tokenApp.auth === 'public')"));
    const body = fn.slice(0, fn.indexOf('\n    if (tokenApp.auth === '));
    expect(body).not.toMatch(/myshopify/);
    // …but it is still checked: a hostname, not an IP, and the scheme is ours to set.
    expect(body).toMatch(/\^\[a-z0-9\.-\]\+\\\.\[a-z\]\{2,\}\$/);
    expect(body).toMatch(/\^\\d\+\(\\\.\\d\+\)\{3\}\$/);
    expect(body).toMatch(/mcpUrl: `https:\/\/\$\{host\}\$\{tokenApp\.path\}`/);
  });

  it('⚠️ a shop that is not Shopify is reported, not left standing', () => {
    // gymshark.com/api/mcp answers 404 — a different platform. Without the probe the tile would show
    // a connector that looks fine and fails on first use.
    expect(CARD).toMatch(/Connected, but the store did not answer/);
  });

  it('the domain field is plain text — it is public information', () => {
    expect(CARD).toMatch(/type=\{tokenApp\.auth === 'token' \? 'password' : 'text'\}/);
  });

  it('no new edge action was needed', () => {
    // `create` has always treated the token as optional, so a credential-less connector needs nothing
    // on the server at all.
    expect(CARD).toMatch(/await createConnector\(\{\s*\n?\s*workspaceId, name: tokenApp\.name/);
  });
});
