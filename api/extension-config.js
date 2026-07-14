// SQEM-063 — public runtime config discovery for the Chrome extension.
//
// Lets one published extension point at ANY Sqemes instance (Cloud or self-hosted): the user
// enters just the instance URL, and the extension fetches the rest from here. All three values are
// public by design — the anon key is a *publishable* key, and the URLs are already visible in the
// served app — so this endpoint is intentionally unauthenticated + CORS-open.
//
// Served at /.well-known/sqemes-extension-config (see vercel.json rewrite).
export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(200).end();
  }

  // .trim() — guard against a trailing newline in the Vercel env var (bit us before).
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  // The app origin the extension watches for the sign-in cookie/sync flow = wherever this endpoint
  // is served, so it self-describes each instance with no extra config.
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const appOrigin = host ? `https://${host}` : '';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({ supabaseUrl, supabaseAnonKey, appOrigin });
}
