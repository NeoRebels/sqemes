import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-359 — the two OAuth providers must NOT agree on `prompt`, and this test exists because they
 * once did.
 *
 * Both blocks were written in the same commit (SQEM-154). Microsoft inherited Google's
 * `prompt: 'consent'`, and it looked like a shared convention rather than the copy it was. It cost a
 * customer their Microsoft connectors: `prompt=consent` re-asks for consent that a tenant admin has
 * already granted org-wide, and in a tenant that disables user consent the connect fails outright.
 *
 * ⛔ The obvious future mistake is not re-introducing `consent` on purpose — it is *tidying* the two
 * blocks into one shape. So the assertions below are written against the **reason**, not just the
 * value: Google needs the forced dialog because it hands out a refresh token only on first consent;
 * Microsoft does not, because it returns one on every exchange that asked for `offline_access`.
 * Should a Microsoft app ever stop requesting `offline_access`, that premise is gone — and the last
 * test here fails before anyone finds out from a dead connector an hour later.
 *
 * ⚠️ Read as TEXT, not imported: `connectorApps.ts` calls `Deno.env.get` at module load and cannot
 * be imported into vitest. Same approach as `apiKeyScopeHints.test.ts`.
 */
const SRC = readFileSync(
  resolve(__dirname, '../../supabase/functions/_shared/connectorApps.ts'), 'utf8',
);

/**
 * Strip comments before matching. The comments in this file quote the old value verbatim to explain
 * why it is gone — without this, the prose would satisfy (or break) the assertions instead of the
 * code doing so.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The `authExtra` literal of one provider, as a key -> value map. */
function authExtra(provider: 'google' | 'microsoft'): Record<string, string> {
  const block = code(SRC).match(
    new RegExp(`\\n  ${provider}:\\s*\\{([\\s\\S]*?)\\n  \\},`),
  );
  expect(block, `${provider} block not found — did PROVIDERS get restructured?`).toBeTruthy();
  const line = block![1].match(/authExtra:\s*\{([^}]*)\}/);
  expect(line, `${provider} has no authExtra`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const m of line![1].matchAll(/([a-z_]+):\s*'([^']*)'/g)) out[m[1]] = m[2];
  return out;
}

/** Every app of one provider, with the scopes it requests. */
function appScopes(provider: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of code(SRC).matchAll(
    /'([a-z-]+)':\s*\{\s*provider:\s*'([a-z]+)'[^}]*?scopes:\s*\[([^\]]*)\]/g,
  )) {
    if (m[2] !== provider) continue;
    out[m[1]] = [...m[3].matchAll(/'([^']+)'/g)].map((s) => s[1]);
  }
  return out;
}

describe('SQEM-359 — connector authExtra', () => {
  it('Microsoft asks for an account, not for consent', () => {
    expect(authExtra('microsoft').prompt).toBe('select_account');
  });

  it('Microsoft never forces the consent dialog again', () => {
    // The exact regression: consent that a tenant admin already granted gets re-asked, and in a
    // tenant with user consent disabled the connect fails instead of merely annoying.
    expect(authExtra('microsoft').prompt).not.toBe('consent');
  });

  it('Microsoft does not use prompt=none either', () => {
    // `none` errors with `interaction_required` whenever the request cannot complete silently, and
    // on a first connect it never can. It would replace an annoying flow with a broken one.
    expect(authExtra('microsoft').prompt).not.toBe('none');
  });

  it('Google keeps the forced consent dialog', () => {
    // Not an inconsistency to clean up: without it Google returns no refresh token after the first
    // consent, and the connector dies at the first token expiry.
    expect(authExtra('google').prompt).toBe('consent');
    expect(authExtra('google').access_type).toBe('offline');
  });

  it('the two providers deliberately differ', () => {
    expect(authExtra('google').prompt).not.toBe(authExtra('microsoft').prompt);
  });

  it('every Microsoft app still requests offline_access — the premise of the change', () => {
    // This is the assertion that matters most. Microsoft may drop the forced dialog *because* it
    // returns a refresh token on every exchange that asked for `offline_access`. Remove that scope
    // from an app and the connector silently loses its refresh token an hour after connecting.
    const apps = appScopes('microsoft');
    expect(Object.keys(apps).length).toBeGreaterThan(0);
    for (const [id, scopes] of Object.entries(apps)) {
      expect(scopes, `${id} must request offline_access`).toContain('offline_access');
    }
  });
});
