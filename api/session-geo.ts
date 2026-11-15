// SQEM-691 — the city and country of the caller, for the Devices card in the profile.
//
// Vercel derives them from the client IP on every request and hands them to its functions as
// `x-vercel-ip-city` (URL-encoded) and `x-vercel-ip-country`. Using those means no IP leaves for a
// third-party lookup service. The function stores nothing and returns no IP: the browser passes the
// answer on to `set_my_session_location`, which files it under its own session only.
// Self-host has no Vercel in front of it and never calls this (the app checks IS_SELF_HOSTED).

type Req = { method?: string; headers: Record<string, string | string[] | undefined> };
type Res = {
  setHeader: (k: string, v: string) => void;
  status: (c: number) => { end: () => void; json: (b: unknown) => void };
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function placeFromHeaders(headers: Req['headers']): { city: string | null; country: string | null } {
  let city = one(headers['x-vercel-ip-city']).trim();
  try { city = decodeURIComponent(city); } catch { /* keep the raw value */ }
  const country = one(headers['x-vercel-ip-country']).trim().toUpperCase();
  return { city: city || null, country: /^[A-Z]{2}$/.test(country) ? country : null };
}

export default function handler(req: Req, res: Res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(placeFromHeaders(req.headers));
}
