import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-467 — a connector is only saved once the server has answered.
 *
 * ⛔ **"Connected" used to mean "we stored a non-empty string."** Two customer cases landed on the
 * same day: a Shopify tile holding an `shpss_` client secret (not an access token at all), and two
 * Plaud rows with no token whatsoever, left by an OAuth flow that was begun and never finished.
 * Both reported themselves as connected.
 *
 * ⭐ **The second kind is not cosmetic.** Anthropic fails the ENTIRE request when one listed MCP
 * server refuses the token, so a single dead connector killed every Claude message its owner sent
 * (SQEM-466). This file is the half that stops such a row from being created at all.
 *
 * ⚠️ **Why a probe rather than a rule about tokens.** A tokenless connector is not necessarily
 * broken — `Shopify Storefront` is public by design and carries none. Its row is indistinguishable
 * from the dead Plaud one. Only the server knows the difference.
 */
const ROOT = resolve(__dirname, '../../');
// ⚠️ Line comments BEFORE block comments — same stripper as `assistantsBecomeSkills.test.ts`.
// Needed here because the docblocks in the function under test quote the very phrases asserted below.
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const src = code(readFileSync(resolve(ROOT, 'supabase/functions/manage-connectors/index.ts'), 'utf8'));

/** The body of one `body.action === '<name>'` branch. */
function branch(name: string): string {
  const start = src.indexOf(`body.action === '${name}'`);
  expect(start, `the '${name}' branch moved or was renamed`).toBeGreaterThan(-1);
  const next = src.indexOf("body.action === '", start + 1);
  return src.slice(start, next > -1 ? next : undefined);
}

describe('SQEM-467 — nothing is stored before the server answers', () => {
  for (const action of ['create', 'create-token']) {
    it(`⛔ '${action}' probes before it inserts`, () => {
      const b = branch(action);
      const probe = b.indexOf('whyUnreachable(');
      const insert = b.indexOf('.insert(');
      expect(probe, `'${action}' no longer probes — that is how the broken rows were created`).toBeGreaterThan(-1);
      expect(insert, `'${action}' no longer inserts — did the branch move?`).toBeGreaterThan(-1);
      expect(probe, 'the probe must run BEFORE the insert, or it guards nothing').toBeLessThan(insert);
    });
  }

  it('⚠️ the probe cannot hang the request', () => {
    // A bare `fetch` against a dead host holds the function until the platform kills it, and the
    // caller sees a timeout instead of a sentence.
    expect(src).toMatch(/fetchWithTimeout\(/);
    expect(src, 'probeMcp must not fall back to a bare fetch').not.toMatch(/=\s*await fetch\(url/);
    expect(src).toMatch(/PROBE_TIMEOUT_MS\s*=\s*\d[\d_]*/);
  });

  it("⛔ the server's own words survive — no invented 'connection failed'", () => {
    // SQEM-273 lost an afternoon to a message that swallowed what the provider had actually said;
    // `lib/aiErrors.ts` in the source repository argues the rule at length.
    expect(src).toMatch(/\$\{why\}/);
    expect(src).toMatch(/\$\{whyToken\}/);
    expect(src.toLowerCase()).not.toMatch(/connection failed/);
  });
});
