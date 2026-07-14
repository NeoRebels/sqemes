export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(200).end();
  }

  // .trim() — guard against a trailing newline in the Vercel env var corrupting the URL.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').trim();
  const oauthBase = `${supabaseUrl}/functions/v1/mcp-oauth`;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const issuer = `https://${host}`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    issuer,
    authorization_endpoint: `${oauthBase}/authorize`,
    token_endpoint: `${oauthBase}/token`,
    registration_endpoint: `${oauthBase}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
