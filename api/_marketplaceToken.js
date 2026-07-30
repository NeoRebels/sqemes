// SQEM-183 — shared server-side helpers for the self-host publisher token: AES-256-GCM encryption
// (reusing API_KEY_ENCRYPTION_KEY), service-role access to the locked-down marketplace_publisher_config
// table, and admin-JWT verification for the config-set endpoint. Never runs in the browser. (On Cloud
// this is inert — the config table is unpopulated and Cloud users publish directly.)
import crypto from 'node:crypto';

const url = () => (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const encKey = () => Buffer.from((process.env.API_KEY_ENCRYPTION_KEY || '').trim(), 'hex');

// ---- AES-256-GCM (self-consistent: this module encrypts and decrypts its own value) ----
export function encryptToken(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64'); // base64(IV | tag | ciphertext)
}
export function decryptToken(b64) {
  const buf = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

// ---- Service-role REST access to the config table ----
async function svc(path, init) {
  return fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, ...(init?.headers || {}) },
  });
}

export async function readCiphertext() {
  try {
    const res = await svc('marketplace_publisher_config?select=token_encrypted&id=eq.1');
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return (rows && rows[0] && rows[0].token_encrypted) || null;
  } catch { return null; }
}

export async function writeCiphertext(ciphertext) {
  const res = await svc('marketplace_publisher_config?on_conflict=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 1, token_encrypted: ciphertext, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`config save failed (${res.status})`);
}

/** Effective publisher token: the DB value (decrypted) first, else the legacy env var. */
export async function resolvePublisherToken() {
  const ct = await readCiphertext();
  if (ct) { try { return decryptToken(ct); } catch { /* corrupt/old key → fall back */ } }
  const env = (process.env.MARKETPLACE_PUBLISHER_TOKEN || '').trim();
  return env || null;
}

/** Whether a token is configured (never reveals the value). */
export async function isConfigured() {
  if (await readCiphertext()) return true;
  return !!(process.env.MARKETPLACE_PUBLISHER_TOKEN || '').trim();
}

/** Verify the request's user JWT and require a workspace-admin role. Returns true iff allowed. */
export async function requireWorkspaceAdmin(req) {
  const auth = (req.headers['authorization'] || req.headers['Authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!auth) return false;
  try {
    const who = await fetch(`${url()}/auth/v1/user`, { headers: { apikey: serviceKey(), Authorization: `Bearer ${auth}` } });
    if (!who.ok) return false;
    const user = await who.json().catch(() => null);
    if (!user || !user.id) return false;
    const res = await svc(`workspace_members?user_id=eq.${user.id}&role=eq.admin&select=user_id&limit=1`);
    if (!res.ok) return false;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}
