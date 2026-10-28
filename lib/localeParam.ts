/**
 * SQEM-612 — the app language on an edge-function call: `…/functions/v1/<name>?locale=de`.
 *
 * Pure (no imports) so it is tested directly; `lib/supabase.ts` calls it from its fetch patch with
 * the two function bases the app talks to — its own and the marketplace's (another instance on
 * self-host). Any other URL comes back unchanged, and so does one that already names a locale.
 *
 * ⛔ A query parameter, never a header: the frontend and the functions deploy independently, so a new
 * frontend can be live minutes before the functions it calls, and a new header triggers a CORS preflight that the old functions refuse —
 * every call would fail in that window. An old function simply ignores an unknown parameter.
 */
export function withLocaleParam(url: string, functionBases: string[], locale: string): string {
  if (!functionBases.some(base => base && url.startsWith(base))) return url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('locale')) return url;
    u.searchParams.set('locale', locale);
    return u.href;
  } catch {
    return url;
  }
}

/** `https://x/functions/v1/marketplace-public` → `https://x/functions/v1/`; anything else → ''. */
export function functionsBaseOf(url: string): string {
  const i = url.indexOf('/functions/v1/');
  return i < 0 ? '' : url.slice(0, i + '/functions/v1/'.length);
}
