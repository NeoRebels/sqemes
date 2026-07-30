// SQEM-181/183 (SQEM-176 Phase B) — self-host → Cloud marketplace submit PROXY.
//
// The publisher token is resolved SERVER-side (SQEM-183: the DB-stored encrypted token set via the
// Settings UI, or the legacy MARKETPLACE_PUBLISHER_TOKEN env). It is never shipped to the browser. The
// self-host frontend posts a bundle here (same-origin); this handler adds the token and forwards it to
// the Cloud `marketplace-submit` edge function. On Cloud this file runs as a Vercel function but is
// unused (no token → canPublish=false; Cloud users publish via the app).
//
//   GET  → { canPublish: <boolean> }   (so the UI knows whether a token is configured)
//   POST { bundle, category } → forwards { token, bundle, category } to the Cloud, relays the response.
import { resolvePublisherToken, isConfigured } from './_marketplaceToken.js';

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;       // Vercel pre-parses
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];                                                    // self-host sidecar: raw stream
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return res.status(200).json({ canPublish: await isConfigured() });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = await resolvePublisherToken();
  if (!token) {
    return res.status(400).json({ error: 'This instance has no marketplace publisher token configured (set it in Settings → General).' });
  }

  // The Cloud submit endpoint — derived from the marketplace API URL (default = Cloud prod).
  const base = (process.env.VITE_MARKETPLACE_API_URL || 'https://api.sqemes.com/functions/v1/marketplace-public')
    .trim().replace(/\/+$/, '');
  const submitUrl = base.replace(/marketplace-public$/, 'marketplace-submit');

  const body = await readJsonBody(req);
  if (!body || !body.bundle) return res.status(400).json({ error: 'Missing bundle' });

  try {
    const upstream = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, bundle: body.bundle, category: body.category }),
    });
    const json = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(json);
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the marketplace: ' + (e && e.message ? e.message : String(e)) });
  }
}
