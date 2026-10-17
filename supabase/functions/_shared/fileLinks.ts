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
