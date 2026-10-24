import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-567 — CI must not depend on an ANONYMOUS image pull: on 2026-10-22 public registries refused
 * seven runs with `toomanyrequests` although nothing was wrong with the code, and the
 * deploy used the same step.
 *
 * Strict in the private repo, silent in the public export (the workflows are pruned there).
 */
const ROOT = resolve(__dirname, '../..');
const PRIVATE = existsSync(resolve(ROOT, 'scripts/build-public-export.sh'));
const wf = (f: string) => readFileSync(resolve(ROOT, '.github/workflows', f), 'utf8');

describe.skipIf(!PRIVATE)('SQEM-567 — no anonymous registry pulls in CI', () => {
  it('both deploys bundle server-side first (--use-api) and fall back to Docker only when that fails', () => {
    for (const f of ['deploy-staging.yml', 'deploy-production.yml']) {
      const w = wf(f);
      // first attempt: server-side, no image; `||` runs the second only on failure
      expect(w, f).toMatch(/supabase functions deploy [^\n]*--use-api \|\| \{/);
      // fallback: the same deploy without --use-api (local Docker bundling), announced as a warning
      expect(w, f).toMatch(/::warning::Server-side bundling failed[^\n]*\n\s+supabase functions deploy (?![^\n]*--use-api)[^\n]*\n\s+\}/);
    }
  });

  it('tenant isolation signs in to ghcr.io and pulls from there, not from public.ecr.aws', () => {
    const w = wf('tenant-isolation.yml');
    expect(w).toMatch(/packages: read/);
    expect(w).toMatch(/uses: docker\/login-action@v3\s+with:\s+registry: ghcr\.io/);
    expect(w).toMatch(/SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr\.io\s+run: npx supabase start/);
    // the sign-in comes before the start
    expect(w.indexOf('Sign in to ghcr.io')).toBeLessThan(w.indexOf('Start local Supabase'));
  });
});
