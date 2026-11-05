/**
 * SQEM-515 — the rules for a download link, in one place. Pure: no Deno, no client, so
 * tests/unit/fileLinks.test.ts can pin every case. Used by `sign-file-url` (the browser on Cloud) and,
 * with SQEM-514, by the MCP server.
 *
 * ⛔ Why links are issued by the server at all: a link signed in the browser cannot be counted, so a
 * daily download ceiling would be one script away from meaningless. Step B of SQEM-515 removes the
 * members' direct read access to storage as well; until then the browser's own signing is gone, not
 * the direct read (the shipped extension still uses it).
 */

/** The storage folder that owns a path: `<workspaceId>/<fileId>/<name>` → `<workspaceId>`. */
export function workspaceOfPath(path: string): string | null {
  const first = String(path ?? '').split('/')[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(first) ? first : null;
}

/** At most this many paths per call — a page of thumbnails, not a dump of the bucket. */
export const MAX_PATHS_PER_CALL = 200;

/** Expiry bounds, in seconds. The browser asks for 5 min by default and longer for cached thumbnails. */
export const MIN_EXPIRY = 30;
export const MAX_EXPIRY = 3600;
export function clampExpiry(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 300;
  return Math.min(MAX_EXPIRY, Math.max(MIN_EXPIRY, v));
}

/**
 * Supabase signs with the URL it was given (`SUPABASE_URL`). Inside the Cloud runtime that is the
 * project's own `*.supabase.co` host; the app talks to `api.sqemes.com`. Point the link at the public
 * host so a link looks like every other Sqemes URL. Paths and the signed token are unchanged.
 */
export function onPublicHost(signedUrl: string, publicBase: string | undefined | null): string {
  if (!publicBase) return signedUrl;
  try {
    const u = new URL(signedUrl);
    const p = new URL(publicBase);
    u.protocol = p.protocol;
    u.host = p.host;
    return u.toString();
  } catch {
    return signedUrl;
  }
}

/** What the browser and agents are told when the daily ceiling is reached. Says when it resets. */
export function dailyLimitMessage(usedToday: number, dayLimit: number): string {
  const mb = (n: number) => Math.round(n / 1048576);
  return `Daily download limit reached: this workspace has downloaded ${mb(usedToday)} MB of ${mb(dayLimit)} MB today. It resets at 00:00 UTC.`;
}

/**
 * SQEM-622 — what an agent tells its person when its code sandbox cannot reach a link we handed out.
 *
 * ⛔ **No MCP server can fix this, and none should be able to.** Claude runs MCP calls on Anthropic's
 * servers, but the PUT/GET on a link happens inside the code-execution sandbox, whose reachable domains
 * are a security setting of the Claude organisation (Team/Enterprise: an owner allows a domain) or of
 * the person (Pro/Max: one network switch). Neither is reachable from here, and the sandbox reports
 * nothing back — a failed PUT never arrives at all. So the one thing we control is the sentence the
 * agent reads next to the link, which it can pass on at the exact moment the upload or download fails.
 * Measured case: IS (2026-10-30) — `curl` exit 56 on the upload link, Team plan, domain not allowed.
 *
 * SQEM-626 — the wording names no client and no settings path. Measured 2026-11-02:
 * ChatGPT fails on DNS in Chat mode (no internet there) but downloads and uploads in Work mode with Work
 * network access on (measured the same day, SQEM-627), Claude Code on
 * the web gets a proxy 403 (environment → Network access → Allowed domains), Codex Cloud calls the tools
 * but its default environment did not reach the host either (it did once the host was allowlisted). A Claude-only path, as SQEM-622 wrote it, sent Claude Code on the web to the
 * wrong settings page; the agent knows its own client's settings, the hint only has to say what to allow.
 *
 * The host comes from the link itself, so a self-hosted instance names its own domain and no product
 * URL is written into the source (it ships to self-host). `tests/unit/sandboxReachHint.test.ts` pins
 * the length and that the host is the link's.
 */
export function sandboxReachHint(link: string): string {
  let host = 'this server';
  try { host = new URL(link).host || host; } catch { /* keep the neutral wording */ }
  return `If your sandbox cannot reach this link (DNS failure, proxy 403, connection reset), ${host} is not among its allowed domains. Tell the person: allow ${host} in this client's network or egress settings, or use the sqemes Files page.`;
}
