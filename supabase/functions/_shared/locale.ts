/**
 * SQEM-599 — the edge functions' ONE seam to the UI texts; the browser's twin is lib/i18n.ts.
 *
 * ⛔ Server code never reads a "current" locale from global state: an edge function serves many
 * people at once. The locale arrives with the request (`locale` in the body), goes through
 * `normalizeLocale`, and is passed to every message: `m.key(inputs, { locale })`.
 *
 * The import below is generated ESM with no package imports (committed; `npm run i18n`).
 */
export { m } from './i18n/messages.js';
import { baseLocale, locales } from './i18n/runtime.js';

export type Locale = typeof locales[number];

/**
 * Anything but a supported locale is the base locale (English) — an old client sends nothing, which
 * is fine. Read from the compiled list (project.inlang), so a new language needs no change here.
 */
export function normalizeLocale(v: unknown): Locale {
  return (locales as readonly unknown[]).includes(v) ? v as Locale : baseLocale;
}

/**
 * SQEM-612 — the language of a request: the `locale` query parameter the web app adds to every
 * function call (lib/supabase.ts), else a `locale` in the body (chat-message since SQEM-599), else
 * English. A caller that sends neither — the extension, an MCP client, curl — gets English.
 *
 * ⛔ A query parameter, not a header: the frontend and the functions deploy independently, so a new
 * frontend can be live minutes before the functions, and a new header triggers a CORS preflight that an old function refuses — every call of
 * the new app would fail in that window. A parameter needs no preflight, and an old function ignores it.
 */
export function requestLocale(req: Request, bodyLocale?: unknown): Locale {
  let fromQuery: string | null = null;
  try { fromQuery = new URL(req.url).searchParams.get('locale'); } catch { /* not a URL — keep going */ }
  return normalizeLocale(fromQuery ?? bodyLocale);
}
