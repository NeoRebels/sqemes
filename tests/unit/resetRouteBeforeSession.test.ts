import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-459 — the password reset link must not reach a line that reads `session`.
 *
 * `pages/ResetPassword.tsx` establishes its own session (SQEM-091: the recovery token arrives as
 * `token_hash` in the fragment and is redeemed by `verifyOtp`, so an email scanner's GET cannot
 * burn the link). The route is therefore reached with **no session by design**, and the guards in
 * `App()` exempt it.
 *
 * ⛔ That exemption lost its cover silently. Until SQEM-264 the fall-through was
 * `<AuthenticatedApp />`, which reads no session; wrapping it in `<LegalGate userId={session.user.id}>`
 * made the one path that legitimately has no session the one that threw. The first render always
 * has `session === null`, so every reset link opened a white screen for a month, and the root has
 * no error boundary above `AuthenticatedApp` to catch it.
 *
 * ⚠️ What this file pins is the ORDER, not the absence: `LegalGate` is supposed to read
 * `session.user.id`. The bug was that something reached it without a session, so the assertion is
 * that the reset route returns first.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// ⚠️ Line comments BEFORE block comments — same stripper as `assistantsBecomeSkills.test.ts`, and
// for the same reason: a `//` line containing `/…/` makes a block-first stripper swallow the file.
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-459 — the reset route renders before anything reads the session', () => {
  const app = code(read('App.tsx'));

  it('⛔ App() returns for the reset route before it dereferences `session`', () => {
    const branch = app.indexOf('if (isResetRoute) {');
    const deref = app.search(/session\.user/);

    expect(branch, 'the unconditional reset-route branch is gone from App()').toBeGreaterThan(-1);
    expect(deref, 'nothing reads session.user any more — has the gate moved?').toBeGreaterThan(-1);
    expect(branch).toBeLessThan(deref);
  });

  it('⛔ the branch is not conditioned on the session being absent', () => {
    // `!session && isResetRoute` would hand the route back to the tree below the moment verifyOtp
    // establishes the recovery session — remounting the form and putting the legal gate in front
    // of the password field, mid-reset.
    expect(app).not.toMatch(/if \(!session && isResetRoute\)/);
  });

  it('⛔ the in-app twin in AppRoutes stays — it is not a duplicate', () => {
    // `isResetRoute` is read from `window.location.hash` at render time, not from state. A reset
    // link pasted into an already-open signed-in tab changes only the hash: HashRouter re-renders,
    // App() does not, and this branch is what serves the route. Removing it sends that visit to
    // the catch-all route.
    expect(app).toMatch(/if \(pathname === '\/reset-password'\) \{/);
  });
});
