/**
 * SQEM-510 — run the MCP functions next to the database, whoever calls them. SQEM-513 — and the
 * database is in IRELAND (`eu-west-1`), not Frankfurt.
 *
 * Supabase executes an Edge Function in the region CLOSEST TO THE CALLER, and there is no per-function
 * setting to change that — only a per-request `x-region` header or `?forceFunctionRegion=` parameter
 * (the header is ignored behind our custom domain, measured; the parameter works). Claude calls the
 * MCP server from the US, so those calls ran in `us-east-1` and each of their database round trips crossed
 * the Atlantic — several times slower than the same call from Europe (measured 2026-10-14).
 * The fix is a hop, not a rewrite:
 * a function that finds itself outside the database's region re-sends the request, unchanged, to its own
 * URL pinned to `HOME_REGION`, and streams the answer back. One transatlantic round trip instead of many.
 *
 * ⛔ **SQEM-513 — `HOME_REGION` is the region of the DATABASE, read from the project, never assumed.**
 * SQEM-510 pinned `eu-central-1` because the database was believed to be in Frankfurt; the Management
 * API says `eu-west-1` (`GET /v1/projects/{ref}` → `region`). In Frankfurt every query still crossed
 * to Ireland and back, and the same MCP calls took about twice as long there as in `eu-west-1`.
 * Frankfurt is also where European callers
 * land on their own, so they are forwarded now too. `lib/env.ts` (`FUNCTION_REGION`) holds the same
 * value for the app's own calls; tests/unit/regionForward.test.ts keeps the two equal.
 *
 * ⛔ Guards, each pinned by tests/unit/regionForward.test.ts:
 *   - no `SB_REGION` (self-host, local) ⇒ never forward — a single server has no other region;
 *   - already forwarded (`x-sqemes-region-forwarded`) ⇒ never forward again: a loop guard. A caller who
 *     sets it themselves only switches the hop off for their own request, so it needs no secret;
 *   - the forward fails ⇒ the caller's request is served HERE (slow, not broken).
 */
export const HOME_REGION = 'eu-west-1';

// Read through globalThis, like chatBudget.ts: this module is also imported by the Node unit tests,
// where the app's TypeScript config knows no `Deno`.
const sbRegion = (): string | undefined =>
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('SB_REGION');
export const FORWARDED_HEADER = 'x-sqemes-region-forwarded';
export const SERVED_REGION_HEADER = 'x-sqemes-served-region';
export const REGION_PARAM = 'forceFunctionRegion';

/**
 * SQEM-513 — a call that lands anywhere in Europe is served where it lands.
 *
 * The hop is not free: re-sending through the public host opens a fresh connection per call. From
 * Frankfurt the database round trips to Ireland cost less than that hop (measured: forwarding from
 * Germany was slower than serving in Frankfurt). From the US the trips
 * cross the Atlantic and the hop wins. So: forward from outside Europe only. Supabase's European
 * regions all carry the `eu-` prefix (eu-central-1/2, eu-west-1/2/3, eu-north-1, eu-south-1).
 * The app is not affected — it pins `eu-west-1` per request (`functionCallUrl()` in lib/env.ts).
 */
export function isNearHome(region: string): boolean {
  return region.startsWith('eu-');
}

export function shouldForward(
  req: { method: string; headers: Headers },
  region: string | undefined,
  needsDatabase: boolean,
): boolean {
  if (!region || region === HOME_REGION) return false;
  if (isNearHome(region)) return false;
  if (req.method === 'OPTIONS') return false;
  if (req.headers.get(FORWARDED_HEADER)) return false;
  return needsDatabase;
}

/** The same request, addressed to our public URL with the home region forced. */
export function forwardUrl(publicBase: string, reqUrl: string): string {
  const u = new URL(reqUrl);
  // Inside the runtime the path is `/<function>/…` — the public one carries `/functions/v1` in front.
  const path = u.pathname.startsWith('/functions/v1/') ? u.pathname : `/functions/v1${u.pathname}`;
  const out = new URL(`${publicBase.replace(/\/+$/, '')}${path}`);
  u.searchParams.forEach((v, k) => out.searchParams.set(k, v));
  out.searchParams.set(REGION_PARAM, HOME_REGION);
  return out.toString();
}

/** Strips the routing parameter so no handler ever sees or passes it on (mcp-oauth copies query params). */
export function withoutRegionParam(url: URL): URL {
  const u = new URL(url.toString());
  u.searchParams.delete(REGION_PARAM);
  return u;
}

/**
 * Forwards `req` to the home region. Returns null when the forward itself failed — the caller then
 * serves the request locally. `body` must be read by the caller first (a request body is read once).
 */
export async function forwardToHome(
  req: Request,
  body: ArrayBuffer | null,
  publicBase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const t0 = performance.now();
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');
  headers.set(FORWARDED_HEADER, sbRegion() ?? 'unknown');
  try {
    const res = await fetchImpl(forwardUrl(publicBase, req.url), {
      method: req.method,
      headers,
      body: body && body.byteLength ? body : undefined,
      redirect: 'manual',
    });
    const out = new Headers(res.headers);
    // ⚠️ fetch hands us the body already DECODED but keeps `content-encoding`; passed on, the client
    // would try to gunzip plain text. The length changes with it. The platform re-encodes on the way out.
    out.delete('content-encoding');
    out.delete('content-length');
    const timing = out.get('server-timing');
    const hop = `forward;dur=${(performance.now() - t0).toFixed(0)}`;
    out.set('server-timing', timing ? `${timing}, ${hop}` : hop);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch (err) {
    console.error(`[region-forward] failed from ${sbRegion()}: ${(err as Error).message} — serving locally`);
    return null;
  }
}
