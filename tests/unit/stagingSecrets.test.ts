import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-391 — the staging alias is written ONCE in `deploy-staging.yml`, and both Supabase secrets
 * that depend on it (`APP_URL`, `ALLOWED_ORIGINS`) are set from that one definition.
 *
 * ⛔ Two literals are how they stopped agreeing: after SQEM-334 changed the alias, APP_URL was
 * updated and ALLOWED_ORIGINS kept the old one — every edge-function call from staging died with
 * "Failed to fetch" (2026-09-13). The reader of that symptom cannot tell it is a stale secret.
 */
const ROOT = resolve(__dirname, '../../');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/deploy-staging.yml'), 'utf8');
const ALIAS = 'https://sqemes-app-git-staging-neorebels-team.vercel.app';

describe('SQEM-391 — deploy-staging.yml: one alias, two secrets', () => {
  it('the alias appears exactly once, as STAGING_APP_URL', () => {
    const literal = WORKFLOW.split('\n').filter(l => l.includes(ALIAS) && !l.trim().startsWith('#'));
    expect(literal, 'non-comment lines carrying the alias').toHaveLength(1);
    expect(literal[0]).toMatch(/^\s*STAGING_APP_URL: https:\/\/sqemes-app-git-staging-neorebels-team\.vercel\.app\s*$/);
  });

  it('⛔ APP_URL and ALLOWED_ORIGINS are both set, both from $STAGING_APP_URL, in one command', () => {
    const step = WORKFLOW.match(/supabase secrets set \\\n([\s\S]*?)--project-ref "\$STAGING_PROJECT_REF"/);
    expect(step, 'the secrets step').not.toBeNull();
    const body = step![1];
    expect(body).toMatch(/APP_URL="\$STAGING_APP_URL"/);
    expect(body).toMatch(/ALLOWED_ORIGINS="\$STAGING_APP_URL,http:\/\/localhost:5173"/);
  });

  it('nothing sets APP_URL or ALLOWED_ORIGINS from a literal any more', () => {
    expect(WORKFLOW).not.toMatch(/APP_URL="https:/);
    expect(WORKFLOW).not.toMatch(/ALLOWED_ORIGINS="https:/);
  });
});
