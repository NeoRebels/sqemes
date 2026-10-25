/**
 * SQEM-590 — the logo of a custom connector: the favicon of its MCP server's site, fetched by US.
 *
 * ⛔ **Fetched server-side on purpose.** Pointing an `<img>` at the vendor's domain would make every
 * viewer's browser call a third party with their IP address on each visit to Settings — the opposite
 * of what sqemes promises about data leaving the instance. The function fetches once and the browser
 * caches the answer for a day.
 *
 * ⛔ **Raster images only — never SVG.** The image is served from OUR functions origin. An SVG can carry
 * script, and someone opening the URL directly would run it on that origin. ICO, PNG, JPEG, GIF and WebP
 * cannot; they are recognised by their bytes, not by the vendor's Content-Type.
 *
 * ⚠️ It fetches only `/favicon.ico` or the icon a site's own home page names, from public hostnames,
 * over https, size-capped — a narrow door, because the endpoint is public (an `<img>` cannot sign in).
 *
 * Pure apart from the injected fetch, so tests/unit can drive it.
 */
export const ICON_MAX_BYTES = 256 * 1024;
const HTML_MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5_000;

/** A hostname we are willing to fetch from: public-looking DNS name, no IP literal, no local names. */
export function isFetchableHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.length > 253 || !/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return false;
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return false;
  if (/^\d+(\.\d+){3}$/.test(h)) return false; // IPv4 literal
  if (/(^|\.)(localhost|local|internal|lan|home|intranet|corp|test|invalid|example)$/.test(h)) return false;
  return h.split('.').every(l => l.length > 0 && l.length <= 63 && !l.startsWith('-') && !l.endsWith('-'));
}

/** `mcp.linear.app` → `linear.app`: an MCP server rarely has a favicon of its own; its site does. */
export function siteHost(host: string): string {
  const parts = host.toLowerCase().split('.');
  return parts.length > 2 && ['mcp', 'api', 'ai', 'server', 'mcp-server'].includes(parts[0]) ? parts.slice(1).join('.') : host.toLowerCase();
}

/** What kind of raster image the bytes are, or null (SVG, HTML, anything else). */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** The icon a home page names (`<link rel="icon" | "apple-touch-icon" …>`), raster ones first. */
export function iconHrefsFromHtml(html: string, base: string): string[] {
  const out: { href: string; score: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    if (/\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag)) continue; // never SVG, see above
    try {
      const u = new URL(href, base);
      if (u.protocol !== 'https:') continue;
      out.push({ href: u.toString(), score: rel.includes('apple-touch-icon') ? 1 : 2 });
    } catch { /* unparsable href */ }
  }
  return out.sort((a, b) => b.score - a.score).map(x => x.href);
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** GET with a size cap, https-only redirects to fetchable hosts, and a timeout. */
async function capped(url: string, max: number, fetchImpl: Fetch): Promise<{ bytes: Uint8Array; finalUrl: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:' || !isFetchableHost(u.hostname)) return null;
    const res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'sqemes-connector-icon/1.0' } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, finalUrl: current };
  }
  return null;
}

/** Find the connector's icon: /favicon.ico on the server's host, then on its site, then the home page's link. */
export async function findConnectorIcon(host: string, fetchImpl: Fetch = fetch): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isFetchableHost(host)) return null;
  const site = siteHost(host);
  const tryIcon = async (url: string) => {
    try {
      const r = await capped(url, ICON_MAX_BYTES, fetchImpl);
      const type = r ? sniffImage(r.bytes) : null;
      return r && type ? { bytes: r.bytes, type } : null;
    } catch { return null; }
  };
  // Last resort: the main domain (`docs.mcp.cloudflare.com` → `cloudflare.com`). Approximate — it
  // ignores two-part suffixes like .co.uk — but a wrong guess only costs one more 404.
  const main = host.toLowerCase().split('.').slice(-2).join('.');
  for (const h of [...new Set([site, host, main])]) {
    const hit = await tryIcon(`https://${h}/favicon.ico`);
    if (hit) return hit;
  }
  try {
    const page = await capped(`https://${site}/`, HTML_MAX_BYTES, fetchImpl);
    if (page) {
      const html = new TextDecoder().decode(page.bytes);
      for (const href of iconHrefsFromHtml(html, page.finalUrl).slice(0, 3)) {
        const hit = await tryIcon(href);
        if (hit) return hit;
      }
    }
  } catch { /* no icon */ }
  return null;
}
