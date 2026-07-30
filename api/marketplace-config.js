// SQEM-183 — self-host publisher token config. GET → { configured } (a boolean; never the token).
// POST { token } stores it AES-GCM-encrypted — **requires an authenticated workspace admin** so a random
// caller can't set or clear the instance's token. On Cloud this is unused (inert).
import { encryptToken, writeCiphertext, isConfigured, requireWorkspaceAdmin } from './_marketplaceToken.js';

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return res.status(200).json({ configured: await isConfigured() });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await requireWorkspaceAdmin(req))) {
    return res.status(403).json({ error: 'Only a workspace admin can set the publisher token.' });
  }

  const body = await readJsonBody(req);
  const token = (body.token || '').trim();
  try {
    if (!token) { await writeCiphertext(null); return res.status(200).json({ configured: false }); } // clear
    if (!/^smp_/.test(token)) return res.status(400).json({ error: "That doesn't look like a publisher token (expected smp_…)." });
    await writeCiphertext(encryptToken(token));
    return res.status(200).json({ configured: true });
  } catch (e) {
    return res.status(500).json({ error: 'Could not save the token: ' + (e && e.message ? e.message : String(e)) });
  }
}
