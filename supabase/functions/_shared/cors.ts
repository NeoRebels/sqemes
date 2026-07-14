const rawOrigins = Deno.env.get('ALLOWED_ORIGINS') || '';
const allowedOrigins = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);

// Fail closed: if ALLOWED_ORIGINS is not configured, no origin is allowed.
// In development you can set ALLOWED_ORIGINS=* to allow all origins.
const allowAll = allowedOrigins.includes('*');

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';

  // Chrome extensions authenticate via JWT — their origin is always safe to reflect.
  const isChromeExtension = origin.startsWith('chrome-extension://');

  let allowedOrigin = '';
  if (allowAll || isChromeExtension) {
    allowedOrigin = origin || '*';
  } else if (allowedOrigins.includes(origin)) {
    allowedOrigin = origin;
  }
  // If origin is not in the list, allowedOrigin stays '' (browser will block CORS)

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Static fallback — returns first allowed origin or empty string.
// Prefer getCorsHeaders(req) for request-aware origin matching.
export const corsHeaders = {
  'Access-Control-Allow-Origin': allowAll ? '*' : (allowedOrigins[0] || ''),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
