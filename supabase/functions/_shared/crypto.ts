/**
 * AES-GCM encryption/decryption for API keys stored in the database.
 *
 * Requires env var: API_KEY_ENCRYPTION_KEY
 *   A 32-byte key encoded as 64 hex characters.
 *   Generate with: openssl rand -hex 32
 *
 * Stored format: base64(12-byte-IV || ciphertext)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('API_KEY_ENCRYPTION_KEY');
  if (!raw || raw.length !== 64) {
    throw new Error(
      'API_KEY_ENCRYPTION_KEY must be set as a 64-character hex string (32 bytes). ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  const keyBytes = hexToBytes(raw);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptApiKey(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptApiKey(stored: string): Promise<string> {
  const key = await getKey();
  let combined: Uint8Array;
  try {
    combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('Stored API key is corrupted (invalid base64). Please re-save the API key in Settings > LLM API Keys.');
  }
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Stored API key could not be decrypted — the encryption key may have changed. Please re-save the API key in Settings > LLM API Keys.');
  }
  return dec.decode(plaintext);
}
