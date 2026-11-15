// SQEM-691 — the Devices card's helpers. The parser itself lives in supabase/functions/_shared/userAgent.ts
// since SQEM-692, because the new-device mail must name a device exactly the way the card does.
// ⚠️ Pure module: tests import it, so it must never import lib/supabase.

export { parseUserAgent, type DeviceKind, type ParsedUserAgent } from '../supabase/functions/_shared/userAgent';

/** The place as one line: "Berlin, DE", "DE", or null when nothing is known. */
export function formatPlace(city: string | null | undefined, country: string | null | undefined): string | null {
  const parts = [city, country].map(p => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** The `session_id` claim of a Supabase access token, or null. Read for a cache key, never trusted. */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.session_id === 'string' ? json.session_id : null;
  } catch {
    return null;
  }
}
