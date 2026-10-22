import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * SQEM-542 — what the app loads before its first render.
 *
 * JSZip (28 KB gzip) and Sentry (29 KB) were preloaded on every page load; the UI font came from
 * Google. Each of these is one line away from coming back, so each is pinned here.
 *
 * ⚠️ Walks the file system, not `git ls-files` — exported to the self-host repo.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(p) ? [p] : [];
  });
}

describe('SQEM-542 — JSZip loads on first use', () => {
  it('no value import of jszip anywhere in lib/, pages/, components/ or store/', () => {
    const offenders = ['lib', 'pages', 'components', 'store']
      .flatMap(d => files(join(ROOT, d), /\.tsx?$/))
      .filter(f => /^import\s+(?!type\b)[^;]*from\s+'jszip'/m.test(readFileSync(f, 'utf8')))
      .map(f => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the subscription gate screen is lazy (it pulls in the account export)', () => {
    const app = read('App.tsx');
    expect(app).not.toMatch(/^import ChoosePlanScreen/m);
    expect(app).toMatch(/const ChoosePlanScreen = React\.lazy\(\(\) => import\('\.\/components\/ChoosePlanScreen'\)\);/);
  });
});

describe('SQEM-542 — the font is ours', () => {
  it('no Google Fonts in the app CSS, the consent page or the CSP', () => {
    for (const f of ['index.css', 'index.html', 'api/oauth-authorize.js', 'vercel.json']) {
      expect(read(f), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  // SQEM-547 — Figtree (text) and Bricolage Grotesque (headings) replaced Inter; still bundled.
  it('Figtree and Bricolage come from the bundled packages and lead their stacks', () => {
    const entry = read('index.tsx');
    expect(entry).toMatch(/import '@fontsource-variable\/figtree\/wght\.css';/);
    expect(entry).toMatch(/import '@fontsource-variable\/bricolage-grotesque\/wght\.css';/);
    expect(entry).not.toMatch(/@fontsource-variable\/inter/);
    const tw = read('tailwind.config.js');
    expect(tw).toMatch(/sans: \['Figtree Variable', 'Figtree',/);
    expect(tw).toMatch(/display: \['Bricolage Grotesque Variable',/);
  });
});

describe('SQEM-542 — Sentry after the first render, nothing lost before it', () => {
  const sentry = { init: vi.fn(), captureException: vi.fn(), setUser: vi.fn() };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
    vi.doMock('@sentry/react', () => sentry);
    sentry.init.mockClear(); sentry.captureException.mockClear(); sentry.setUser.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@sentry/react'); vi.restoreAllMocks(); });

  it('buffers errors and the user until Sentry has loaded, then replays them once', async () => {
    const m = await import('../../lib/monitoring');
    m.logError(new Error('early'), { context: 'test' });
    m.setMonitoringUser('u1', 'a@b.c');
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();

    await m.loadSentry();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect((sentry.captureException.mock.calls[0][0] as Error).message).toBe('early');
    expect(sentry.setUser).toHaveBeenCalledWith({ id: 'u1', email: 'a@b.c' });

    m.logError(new Error('late'));
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it('caps the buffer, keeping the first errors', async () => {
    const m = await import('../../lib/monitoring');
    for (let i = 0; i < m.MAX_PENDING + 5; i++) m.logError(new Error(`e${i}`));
    await m.loadSentry();
    expect(sentry.captureException).toHaveBeenCalledTimes(m.MAX_PENDING);
    expect((sentry.captureException.mock.calls[0][0] as Error).message).toBe('e0');
  });
});
