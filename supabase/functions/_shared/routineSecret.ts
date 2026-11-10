/**
 * SQEM-679 — the routine dispatch secret, which `routine-run` and `chat-message` compare with the
 * `x-routine-dispatch` header the database sends (Vault `routine_dispatch_secret`).
 *
 * Cloud sets `ROUTINE_DISPATCH_SECRET` by hand per project (see `pm/PRODUCTION_PROMOTION.md` in the source repository).
 * A self-hosted instance gets it without a step: when the variable is missing and
 * `SELF_HOSTED=true`, the secret is DERIVED from the service key, and `selfhost/init/apply.sh` writes the
 * same value into the Vault on every start (`extensions.hmac` there, Web Crypto here — a unit test pins
 * both to one value). ⛔ No new `.env` variable on purpose: `generate-secrets.sh` does nothing on an
 * existing install, so an update would never get one. Whoever holds the service key can start a run with
 * it — but whoever holds the service key holds the whole database already.
 *
 * Deliberately free of imports, so tests/unit reach it.
 */
export const ROUTINE_SECRET_LABEL = 'sqemes-routine-dispatch';

/** HMAC-SHA256(key = service key, message = label), lower-case hex — `encode(extensions.hmac(label, key, 'sha256'), 'hex')`. */
export async function deriveRoutineDispatchSecret(serviceKey: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(serviceKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(ROUTINE_SECRET_LABEL)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

/** The secret to compare with: the configured one, the derived one on self-host, or '' (refuse everything). */
export async function routineDispatchSecret(env: (name: string) => string | undefined): Promise<string> {
  const configured = env('ROUTINE_DISPATCH_SECRET') ?? '';
  if (configured) return configured;
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (env('SELF_HOSTED') !== 'true' || !serviceKey) return '';
  return deriveRoutineDispatchSecret(serviceKey);
}
