import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-443 — a provider error that arrives after the connector exists is not a failure.
 *
 * Observed with Nifty: the tile said connected and the toast said "Connection failed:
 * invalid_request" at the same moment, and both were true. A callback can be reached twice — the
 * consent screen's own navigation, a back button, a re-fired URL — and the second arrival presents a
 * spent code, so the provider answers `invalid_request`. The first had already created the connector.
 */
const ROOT = resolve(__dirname, '../../');
const CALLBACK = readFileSync(resolve(ROOT, 'supabase/functions/connector-oauth-callback/index.ts'), 'utf8');

describe('SQEM-443 — a late provider error', () => {
  it('⛔ checks for an existing connector before reporting failure', () => {
    const fn = CALLBACK.slice(CALLBACK.indexOf('if (oauthError) {'));
    const body = fn.slice(0, fn.indexOf('\n    if (!code || !state)'));
    expect(body).toMatch(/from\('workspace_connectors'\)/);
    expect(body).toMatch(/if \(existing\) return back\(`connector=connected/);
    // …and it still ends in an error when there is none.
    // ⚠️ The rule, not the string: SQEM-448 appended the provider's description to this redirect.
    // What must hold is that the branch still ENDS in an error when no connector was found.
    expect(body).toMatch(/return back\(`connector=error&reason=\$\{encodeURIComponent\(oauthError\)\}/);
  });

  it('⛔ the condition is narrow — this must not swallow real failures', () => {
    // Only when the state decrypts AND names workspace, user and a known app, AND the row is there.
    const fn = CALLBACK.slice(CALLBACK.indexOf('if (oauthError) {'));
    const body = fn.slice(0, fn.indexOf('\n    if (!code || !state)'));
    expect(body).toMatch(/if \(stateOk && payload\.w && payload\.u\)/);
    expect(body).toMatch(/MCP_OAUTH_APPS\[payload\.a \?\? ''\]\?\.name.*CONNECTOR_APPS\[payload\.a \?\? ''\]\?\.name/s);
    expect(body).toMatch(/\.eq\('workspace_id', payload\.w\)\.eq\('user_id', payload\.u\)\.eq\('name', appName\)/);
  });

  it('⚠️ a failed decrypt is still bad_state, not success', () => {
    // `stateOk` replaced a throwing parse; the later guards must still reject an unusable state.
    expect(CALLBACK).toMatch(/if \(!stateOk\) return back\('connector=error&reason=bad_state'\)/);
    expect(CALLBACK).toMatch(/if \(!payload\?\.w \|\| !payload\?\.u\) return back\('connector=error&reason=bad_state'\)/);
  });

  it('⛔ SQEM-448 — the provider’s own words travel, not just its code', () => {
    // `invalid_request` fits a dozen causes and names none. The token-exchange branch has read
    // `error_description` since SQEM-273; this branch never got the lesson, and two rounds were spent
    // guessing at exactly that.
    const CARD = readFileSync(resolve(ROOT, 'components/ConnectorsCard.tsx'), 'utf8');
    expect(CALLBACK).toMatch(/url\.searchParams\.get\('error_description'\)/);
    expect(CALLBACK).toMatch(/desc=\$\{encodeURIComponent\(desc\.slice\(0, 300\)\)\}/);
    expect(CARD).toMatch(/const desc = searchParams\.get\('desc'\)/);
    expect(CARD).toMatch(/\$\{desc \? ` \$\{desc\}` : ''\}/);
  });

  it('⚠️ …and it is logged too, because a redirect can be truncated', () => {
    expect(CALLBACK).toMatch(/console\.error\('\[connector-oauth\] provider redirected with an error'/);
    expect(CALLBACK).toMatch(/description: desc\.slice\(0, 500\)/);
  });

  it('the new parameter is cleaned out of the URL like the others', () => {
    const CARD = readFileSync(resolve(ROOT, 'components/ConnectorsCard.tsx'), 'utf8');
    for (const m of CARD.matchAll(/\['connector', 'name', 'reason', 'code', ([^\]]*)\]/g)) {
      expect(m[1]).toContain("'desc'");
    }
  });

  it('⚠️ the trade-off is written down where the code makes it', () => {
    expect(CALLBACK).toMatch(/must not become a way to swallow real failures/);
  });

  it('⛔ a second layer in the client, because some providers drop the state', () => {
    // The server-side check needs `state` back. Nifty does not return it on an error, so the tile said
    // connected while the toast said failed — both true, and the server could not tell. The client
    // decides on what it can see instead: a connector created moments ago.
    const CARD = readFileSync(resolve(ROOT, 'components/ConnectorsCard.tsx'), 'utf8');
    expect(CARD).toMatch(/Date\.now\(\) - new Date\(c\.created_at\)\.getTime\(\) < 120_000/);
    expect(CARD).toMatch(/showToast\(`\$\{justNow\.name\} connected`, 'success'\)/);
  });

  it('⛔ …and OUR OWN stages stay loud', () => {
    // `token_exchange`, `save_failed`, `bad_state` and friends describe something that really went
    // wrong here. Only a provider's own error code can be downgraded.
    const CARD = readFileSync(resolve(ROOT, 'components/ConnectorsCard.tsx'), 'utf8');
    expect(CARD).toMatch(/const OUR_STAGES = \['missing_code', 'bad_state', 'expired', 'bad_app', 'token_exchange', 'save_failed', 'mcp_oauth', 'no_token'\]/);
    expect(CARD).toMatch(/if \(reason && !OUR_STAGES\.includes\(reason\)\)/);
  });
});
