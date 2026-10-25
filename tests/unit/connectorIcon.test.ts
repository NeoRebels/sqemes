import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isFetchableHost, siteHost, sniffImage, iconHrefsFromHtml, findConnectorIcon, ICON_MAX_BYTES } from '../../supabase/functions/_shared/connectorIcon';

/** SQEM-590 — custom-connector logos: fetched by us, raster only, from public hosts only. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('which hosts may be fetched', () => {
  it('public names yes', () => {
    for (const h of ['mcp.linear.app', 'docs.mcp.cloudflare.com', 'example-site.de']) expect(isFetchableHost(h), h).toBe(true);
  });
  it('⛔ IP literals, local and reserved names, malformed input no', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '169.254.169.254', 'localhost', 'db.internal', 'nas.local', 'x', '', 'a..b.com', '-a.com', 'a.com.', 'evil.com/../x', '[::1]'])
      expect(isFetchableHost(h), h).toBe(false);
  });
  it('the site of an MCP host', () => {
    expect(siteHost('mcp.linear.app')).toBe('linear.app');
    expect(siteHost('api.example.com')).toBe('example.com');
    expect(siteHost('docs.mcp.cloudflare.com')).toBe('docs.mcp.cloudflare.com');
    expect(siteHost('mcp.io')).toBe('mcp.io');
  });
});

describe('what counts as an image', () => {
  it('raster formats by their bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(ICO)).toBe('image/x-icon');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
  });
  it('⛔ SVG and HTML never — they would be served from our origin', () => {
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });
  it('icon links from a home page: raster, https, resolved, SVG skipped', () => {
    const html = '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="https://cdn.x.com/i.png"><link rel="icon" href="http://insecure/i.png">';
    expect(iconHrefsFromHtml(html, 'https://site.com/')).toEqual(['https://cdn.x.com/i.png', 'https://site.com/apple.png']);
  });
});

describe('findConnectorIcon', () => {
  const res = (body: Uint8Array | string, status = 200, headers: Record<string, string> = {}) =>
    new Response(typeof body === 'string' ? body : body, { status, headers });
  it('site favicon first', async () => {
    const f = vi.fn(async (url: string) => url === 'https://linear.app/favicon.ico' ? res(ICO) : res('', 404));
    expect(await findConnectorIcon('mcp.linear.app', f)).toEqual({ bytes: ICO, type: 'image/x-icon' });
  });
  it('falls back to the icon the home page names, and ignores a favicon that is really SVG', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/favicon.ico')) return res(SVG);
      if (url === 'https://example.com/') return res('<link rel="icon" href="/img/logo.png">');
      if (url === 'https://example.com/img/logo.png') return res(PNG);
      return res('', 404);
    });
    expect(await findConnectorIcon('mcp.example.com', f)).toEqual({ bytes: PNG, type: 'image/png' });
  });
  it('⛔ a redirect to a local address is not followed', async () => {
    const f = vi.fn(async () => res('', 302, { location: 'https://127.0.0.1/favicon.ico' }));
    expect(await findConnectorIcon('mcp.example.com', f)).toBeNull();
  });
  it('⛔ an oversized answer is dropped', async () => {
    const big = new Uint8Array(ICON_MAX_BYTES + 10); big.set(PNG);
    const f = vi.fn(async (url: string) => url.endsWith('/favicon.ico') ? res(big) : res('', 404));
    expect(await findConnectorIcon('mcp.example.com', f)).toBeNull();
  });
  it('a disallowed host is never fetched at all', async () => {
    const f = vi.fn();
    expect(await findConnectorIcon('localhost', f as never)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
  it('custom connectors render ConnectorLogo; the function answers with raster images and nosniff', () => {
    expect(read('components/ConnectorsCard.tsx')).toMatch(/<ConnectorLogo mcpUrl=\{c\.mcp_url\} \/>/);
    const fn = read('supabase/functions/connector-icon/index.ts');
    expect(fn).toMatch(/'X-Content-Type-Options': 'nosniff'/);
    expect(fn).toMatch(/'Content-Type': icon\.type/);
    expect(read('components/ConnectorLogo.tsx')).toMatch(/functionCallUrl\('connector-icon'\)/);
  });
});
