import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROLE_LABELS } from '../../constants';

/**
 * SQEM-261 — Gleap, and the four things about it that are promises rather than preferences.
 *
 * Read as source: `lib/gleap.ts` imports the SDK, which touches `window` at import time, and the
 * point of these tests is the *shape* of the integration, not its runtime.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const GLEAP = read('lib/gleap.ts');
const BOOT = read('components/GleapBoot.tsx');
const APP = read('App.tsx');
const CSP = read('vercel.json');
const SETTINGS = read('pages/Settings.tsx');

describe('SQEM-261 — how Gleap is allowed to be wired', () => {
  it('⛔ the session recorder is masked BEFORE initialize, not after', () => {
    // `Gleap.initialize()` starts the recorder unconditionally; the dashboard flag only stops it once
    // the project config arrives. Masking set afterwards would leave that window unprotected.
    // ⚠️ Search the CALLS, not the prose: the comment above them names both by name, and an
    // indexOf over the whole file finds the explanation instead of the code.
    const setOpts = GLEAP.indexOf('Gleap.setReplayOptions({');
    const init = GLEAP.indexOf('Gleap.initialize(KEY);');
    expect(setOpts).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(-1);
    expect(setOpts, 'setReplayOptions must come first').toBeLessThan(init);
    expect(GLEAP).toMatch(/maskAllInputs: true/);
    expect(GLEAP).toMatch(/maskTextSelector: '\*'/);
  });

  it('⚠️ it is loaded on demand — a static import puts rrweb in the entry chunk', () => {
    // Measured: the entry chunk went 124 kB → 719 kB with a top-level import, for a widget only
    // signed-in people ever see. Every visitor paid for it.
    expect(GLEAP).toMatch(/await import\('gleap'\)/);
    expect(GLEAP).not.toMatch(/^import Gleap from 'gleap'/m);
  });

  it('⛔ no key, no Gleap — this is what keeps it out of a self-hosted build', () => {
    expect(GLEAP).toMatch(/import\.meta\.env\.VITE_GLEAP_API_KEY \?\? ''\)\.trim\(\)/);
    expect(GLEAP).toMatch(/gleapConfigured = KEY !== ''/);
    // The guard split in two when the log line went in: `started` first, then the key (which reports).
    expect(GLEAP).toMatch(/if \(started\) return;/);
    expect(GLEAP).toMatch(/if \(!gleapConfigured\) \{/);
  });

  it('⚠️ a missing key SAYS so — a silent feature is undiagnosable', () => {
    // Without this the only symptom is an absent widget, which looks exactly like a blocked request,
    // a hidden button or a bug in this file. It cost a round of guessing on 2026-09-16.
    expect(GLEAP).toMatch(/console\.info\('\[gleap\] disabled/);
    expect(GLEAP).toMatch(/inlined at build time/);
    expect(GLEAP).toMatch(/console\.info\('\[gleap\] started'\)/);
  });

  it('⛔ it never mounts outside the authenticated tree', () => {
    // The public listing page (/library/:id) is read by strangers who agreed to nothing.
    const boot = APP.indexOf('<GleapBoot />');
    const publicRoutes = APP.indexOf('<Route path="/library/:id" element={<PublicListing />} />');
    expect(boot).toBeGreaterThan(-1);
    expect(publicRoutes).toBeGreaterThan(-1);
    // The public branch returns before AppRoutes' tree; the boot component sits in the latter.
    expect(APP.slice(0, boot)).toMatch(/const AppRoutes = \(\) => \{/);
    expect(BOOT).toMatch(/if \(!currentUser\?\.id \|\| !workspace\?\.id\) return;/);
  });

  it('⛔ SQEM-432 — the role reaches Gleap as the word the APP uses', () => {
    // `admin` in a report the owner reads, next to an app that says `Admin` everywhere, is two
    // vocabularies for one thing. The label comes from the single map, not from a local expression.
    expect(GLEAP).toMatch(/role: ROLE_LABELS\[user\.role\] \?\? user\.role/);
    expect(GLEAP).toMatch(/import \{ ROLE_LABELS \} from '\.\.\/constants'/);
    expect(ROLE_LABELS.admin).toBe('Admin');
    expect(ROLE_LABELS.editor).toBe('Editor');
    expect(ROLE_LABELS.member).toBe('Member');
  });

  it('⛔ …and the STORED value stays lower-case, or RLS stops matching', () => {
    // Applying the label to a `value` attribute would write "Admin" into workspace_members.role.
    // That is the one way this change could break access control, so it is pinned rather than
    // trusted to review.
    for (const m of SETTINGS.matchAll(/<option key=\{r\} value=\{(\w+)\}/g)) expect(m[1]).toBe('r');
    for (const m of SETTINGS.matchAll(/<option value="([^"]+)"/g)) expect(m[1]).toBe(m[1].toLowerCase());
    expect(SETTINGS).not.toMatch(/value=\{ROLE_LABELS/);
  });

  it('the invite dialog keeps its explanations', () => {
    // "Admin (Full Access)" — the label is shared, the parenthetical is not. Folding it into the map
    // would delete an explanation somebody wrote on purpose.
    expect(SETTINGS).toMatch(/\{ROLE_LABELS\.admin\} \(Full Access\)/);
    expect(SETTINGS).toMatch(/\{ROLE_LABELS\.editor\} \(Can Create\)/);
    expect(SETTINGS).toMatch(/\{ROLE_LABELS\.member\} \(Read Only\)/);
  });

  it('⚠️ the CSP names what Gleap needs — otherwise it fails silently', () => {
    expect(CSP).toMatch(/connect-src[^"]*https:\/\/api\.gleap\.io/);
    expect(CSP).toMatch(/connect-src[^"]*wss:\/\/ws\.gleap\.io/);
    // frame-src was absent, so the widget iframe fell back to default-src 'self' and was blocked.
    expect(CSP).toMatch(/frame-src 'self' https:\/\/messenger-app\.gleap\.io/);
    // ⛔ The SDK is bundled via npm precisely so this can stay closed (SQEM-111).
    // ⚠️ Read the ONE directive: `[^"]*` runs past the semicolon into style-src, which legitimately
    // carries 'unsafe-inline' — and then this assertion fails on a policy that is perfectly fine.
    const scriptSrc = CSP.match(/script-src[^;"]*/)![0];
    expect(scriptSrc).toBe("script-src 'self'");
  });
});
