import { getCorsHeaders } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { fetchWithTimeout } from '../_shared/fetchWithTimeout.ts';

// Fetch a user-supplied URL and return its visible text. SSRF-sensitive: this is
// the ONLY thing this function does. No AI, no key handling — extraction runs on
// the client via runAuthoringAI (SQEM-035 / Option B).

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_TEXT_CHARS = 10_000;

function ipv4Blocked(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 127) return true;              // this-network, loopback
  if (a === 10) return true;                           // private
  if (a === 172 && b >= 16 && b <= 31) return true;    // private
  if (a === 192 && b === 168) return true;             // private
  if (a === 169 && b === 254) return true;             // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                           // multicast / reserved
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;          // loopback / unspecified
  if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4Blocked(mapped[1]);
  return false;
}

/**
 * inet_aton-style parse of an IPv4 literal. Accepts the sneaky encodings the OS resolver /
 * fetch still honour but a naive dotted-decimal check misses: integer (2130706433), hex
 * (0x7f000001), octal (0177.0.0.1) and mixed (0x7f.1). Returns canonical dotted-decimal, or
 * null if the host isn't an IPv4 literal in any of these forms (i.e. it's a real DNS name).
 */
function canonicalizeIpv4(host: string): string | null {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const vals: number[] = [];
  for (const part of parts) {
    if (part === '') return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(part)) n = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else if (/^[1-9]\d*$/.test(part) || part === '0') n = parseInt(part, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    vals.push(n);
  }
  const n = vals.length;
  let value: number;
  if (n === 1) {
    value = vals[0];
    if (value > 0xffffffff) return null;
  } else {
    for (let i = 0; i < n - 1; i++) if (vals[i] > 255) return null;
    const rem = 4 - (n - 1);
    const last = vals[n - 1];
    if (last >= 2 ** (8 * rem)) return null;
    value = 0;
    for (let i = 0; i < n - 1; i++) value = value * 256 + vals[i];
    value = value * 2 ** (8 * rem) + last;
  }
  value = value >>> 0;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

/**
 * Resolve a DNS name to its A/AAAA records. Prefers Deno.resolveDns when the runtime exposes
 * it; otherwise falls back to DNS-over-HTTPS (reliable on Deno Deploy, where resolveDns is
 * unavailable). Returns null when resolution fails entirely so the caller can fail CLOSED.
 */
async function resolveHostIps(host: string): Promise<string[] | null> {
  const resolveDns = (Deno as any).resolveDns;
  if (typeof resolveDns === 'function') {
    try {
      const [a, aaaa] = await Promise.all([
        resolveDns(host, 'A').catch(() => [] as string[]),
        resolveDns(host, 'AAAA').catch(() => [] as string[]),
      ]);
      return [...a, ...aaaa];
    } catch { /* fall through to DoH */ }
  }
  try {
    const ips: string[] = [];
    for (const type of ['A', 'AAAA']) {
      const r = await fetchWithTimeout(
        `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: 'application/dns-json' } },
        4_000,
      );
      if (!r.ok) { await r.body?.cancel(); continue; }
      const data = await r.json();
      for (const ans of data?.Answer ?? []) {
        if (ans.type === 1 || ans.type === 28) ips.push(String(ans.data)); // A / AAAA
      }
    }
    return ips;
  } catch {
    return null; // resolution unavailable → fail closed
  }
}

/**
 * Block if the host is localhost / an internal suffix / a private-or-reserved IP, in literal
 * form (any encoding) OR by DNS resolution. SQEM-108: fails CLOSED — a host we can't resolve,
 * or one resolving to a private/reserved IP, is rejected rather than fetched. (Residual: fetch
 * re-resolves independently, so a rebinding race remains; true pinning isn't feasible with
 * fetch + HTTPS SNI, but resolve-then-reject closes the fail-open + alternate-encoding holes.)
 */
async function hostBlocked(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) return ipv6Blocked(h);            // IPv6 literal

  const canon = canonicalizeIpv4(h);                     // IPv4 literal in ANY encoding
  if (canon) return ipv4Blocked(canon);

  const ips = await resolveHostIps(h);                   // DNS name → resolve + validate
  if (ips === null || ips.length === 0) return true;     // unresolvable → fail closed
  return ips.some(ip => (ip.includes(':') ? ipv6Blocked(ip) : ipv4Blocked(ip)));
}

function parseUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

/** Fetch following redirects manually, re-validating the host at every hop. */
async function safeFetch(start: URL): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await hostBlocked(url.hostname)) throw new Error('blocked-host');
    const res = await fetchWithTimeout(
      url.toString(),
      { redirect: 'manual', headers: { 'User-Agent': 'SqemesBot/1.0 (+https://sqemes.com)', Accept: 'text/html,application/xhtml+xml' } },
      FETCH_TIMEOUT_MS,
    );
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      const next = parseUrl(new URL(loc, url).toString());
      if (!next) throw new Error('bad-redirect');
      await res.body?.cancel();
      url = next;
      continue;
    }
    return res;
  }
  throw new Error('too-many-redirects');
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) { await reader.cancel(); break; }
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const room = merged.length - off;
    if (room <= 0) break;
    merged.set(c.subarray(0, room), off);
    off += Math.min(c.length, room);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const adminClient = createAdminClient();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const { url, workspaceId } = await req.json();
    if (!url || !workspaceId) return json({ error: 'url and workspaceId are required' }, 400);

    // Caller must belong to the workspace (and it gates the rate-limit bucket).
    const { data: member } = await adminClient
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member) return json({ error: 'Forbidden' }, 403);

    if (!(await checkRateLimit(workspaceId))) {
      return json({ error: 'Rate limit exceeded. Please wait a moment and try again.' }, 429);
    }

    const target = parseUrl(url);
    if (!target) return json({ error: 'Enter a valid http(s) URL.' }, 400);

    let res: Response;
    try {
      res = await safeFetch(target);
    } catch (err: any) {
      const msg = err?.message === 'blocked-host'
        ? 'That address can\'t be reached.'
        : 'Could not load that page. Check the URL or fill the form in manually.';
      return json({ error: msg }, 422);
    }

    if (!res.ok) {
      await res.body?.cancel();
      return json({ error: `The site returned ${res.status}. Try another URL or fill the form in manually.` }, 422);
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
      await res.body?.cancel();
      return json({ error: 'That URL isn\'t a web page. Paste your homepage URL or fill the form in manually.' }, 422);
    }

    const html = await readCapped(res, MAX_BYTES);
    const text = stripHtml(html);
    if (text.length < 50) {
      return json({ error: 'Couldn\'t read enough text from that page. Fill the form in manually.' }, 422);
    }

    return json({ text });
  } catch (err: any) {
    return json({ error: err?.message ?? 'Unexpected error' }, 500);
  }
});
