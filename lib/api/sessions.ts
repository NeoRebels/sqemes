// SQEM-691 — the person's own sign-in sessions, for the Devices card in the profile.
import { supabase } from '../supabase';
import { IS_SELF_HOSTED } from '../env';
import { sessionIdFromAccessToken } from '../userAgent';

export interface MySession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  isCurrent: boolean;
}

export async function fetchMySessions(): Promise<MySession[]> {
  const { data, error } = await supabase.rpc('list_my_sessions');
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    userAgent: r.user_agent,
    ip: r.ip,
    city: r.city,
    country: r.country,
    isCurrent: r.is_current,
  }));
}

/** Ends another session. Its refresh token dies at once; its access token runs out within the hour. */
export async function revokeMySession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_my_session', { p_session_id: sessionId });
  if (error) throw error;
}

export async function signOutOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' });
  if (error) throw error;
}

const GEO_KEY = 'sqemes_session_geo';

/**
 * Files the place of THIS session once per session (Cloud only). Called when a session appears, so a
 * device that never opens Settings still gets its place. Failure is silent: the card then says
 * "location unknown", which is the honest answer.
 */
export async function recordSessionLocation(accessToken: string | undefined): Promise<void> {
  if (IS_SELF_HOSTED) return;
  const sid = sessionIdFromAccessToken(accessToken);
  if (!sid) return;
  try {
    if (localStorage.getItem(GEO_KEY) === sid) return;
    const res = await fetch('/api/session-geo', { cache: 'no-store' });
    if (!res.ok) return;
    const { city, country } = await res.json() as { city: string | null; country: string | null };
    if (!city && !country) return;
    const { error } = await supabase.rpc('set_my_session_location', { p_city: city, p_country: country });
    if (!error) localStorage.setItem(GEO_KEY, sid);
  } catch {
    /* no place, no harm */
  }
}
