import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveRoutineDispatchSecret, routineDispatchSecret, ROUTINE_SECRET_LABEL } from '../../supabase/functions/_shared/routineSecret';

/** SQEM-679 — Routines on self-host: the dispatch secret derived from the service key, the Vault set by init. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const env = (vars: Record<string, string>) => (name: string) => vars[name];

describe('the derived dispatch secret', () => {
  it('is HMAC-SHA256 with the service key as key and the label as message — what pgcrypto computes in init', async () => {
    const expected = createHmac('sha256', 'svc-key-123').update(ROUTINE_SECRET_LABEL).digest('hex');
    expect(await deriveRoutineDispatchSecret('svc-key-123')).toBe(expected);
    expect(expected).toHaveLength(64);
  });

  it('Cloud: the configured secret wins and nothing is derived', async () => {
    expect(await routineDispatchSecret(env({ ROUTINE_DISPATCH_SECRET: 'x'.repeat(64), SELF_HOSTED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'k' }))).toBe('x'.repeat(64));
    expect(await routineDispatchSecret(env({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))).toBe('');
  });

  it('self-host without the variable: derived; without a service key: refuse everything', async () => {
    expect(await routineDispatchSecret(env({ SELF_HOSTED: 'true', SUPABASE_SERVICE_ROLE_KEY: 'k' }))).toBe(await deriveRoutineDispatchSecret('k'));
    expect(await routineDispatchSecret(env({ SELF_HOSTED: 'true' }))).toBe('');
  });
});

describe('wiring', () => {
  it('init writes the same value into the Vault, from the service key, on every start', () => {
    const init = read('selfhost/init/apply.sh');
    expect(init).toContain(`encode(extensions.hmac('${ROUTINE_SECRET_LABEL}', current_setting('sqemes.svc'), 'sha256'), 'hex')`);
    expect(init).toMatch(/routine_run_url/);
    expect(init).toMatch(/http:\/\/kong:8000\/functions\/v1\/routine-run/);
    expect(read('selfhost/docker-compose.sqemes.yml')).toMatch(/SERVICE_ROLE_KEY: \$\{SERVICE_ROLE_KEY\}/);
  });

  it('both functions compare with routineDispatchSecret, not the raw variable', () => {
    for (const f of ['supabase/functions/routine-run/index.ts', 'supabase/functions/chat-message/index.ts']) {
      const src = read(f);
      expect(src, f).toMatch(/await routineDispatchSecret\(name => Deno\.env\.get\(name\)\)/);
      expect(src, f).not.toMatch(/Deno\.env\.get\('ROUTINE_DISPATCH_SECRET'\)/);
    }
  });

  it('routines_available says yes or no and is closed to anonymous callers', () => {
    const sql = read('supabase/migrations/20261110200000_sqem679_routines_available.sql');
    expect(sql).toMatch(/returns boolean/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on function public\.routines_available\(\) from public, anon;/);
    expect(sql).not.toMatch(/decrypted_secret/);
  });
});
