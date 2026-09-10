import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-361 — the manifest, and the service worker we deliberately did not write.
 *
 * ⭐ Half of this ticket is a *non*-decision, and a non-decision leaves no code behind to read.
 * The tests at the bottom are where it is written down: no worker, no offline claim. Someone adding
 * one later should have to delete an assertion that says why, rather than merely notice nothing.
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const manifest = JSON.parse(readFileSync(root('public/manifest.json'), 'utf8'));
/**
 * ⚠️ Comments stripped, and not as a precaution: the block in `index.html` explains at length why
 * the file is NOT called `.webmanifest`, so the assertion below would match its own justification.
 * Third time in this repo that documenting a decision broke the test guarding it (SQEM-359, -360).
 */
const INDEX = readFileSync(root('index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Width, height and colour type straight out of a PNG's IHDR — no image library needed.
 * Colour type 6 = RGBA, 2 = RGB (no alpha channel at all).
 */
function png(file: string): { width: number; height: number; colorType: number } {
  const b = readFileSync(root(file));
  expect(b.subarray(0, 8).toString('hex'), `${file} is not a PNG`).toBe('89504e470d0a1a0a');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

describe('SQEM-361 — the manifest says what it should', () => {
  it('carries the fields an installable app needs', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.name).toBe('Sqemes');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('does not lock the orientation', () => {
    // SQEM-360 found that landscape is the case that actually breaks things — locking to portrait
    // would hide it rather than fix it, and would take a legitimate way of holding a tablet away.
    expect(manifest.orientation).toBeUndefined();
  });

  it('promises nothing about working offline', () => {
    // The app is a thin client over Supabase and the AI providers. Nothing meaningful works without
    // a network, so nothing here may suggest it does.
    const text = JSON.stringify(manifest).toLowerCase();
    expect(text).not.toContain('offline');
  });
});

describe('SQEM-361 — every declared icon exists at the size it claims', () => {
  it('has at least one 192 and one 512 icon', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  for (const icon of manifest.icons as { src: string; sizes: string; purpose?: string }[]) {
    it(`${icon.src} is really ${icon.sizes}`, () => {
      // A manifest declaring 512x512 for a 513px file is the kind of defect that produces a blurry
      // launcher icon and no error anywhere. The source logo is in fact 513px square.
      const file = `public${icon.src}`;
      expect(existsSync(root(file)), `${file} is missing`).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      const meta = png(file);
      expect(meta.width).toBe(w);
      expect(meta.height).toBe(h);
    });
  }

  it('the maskable icon is a separate file from the plain one', () => {
    // The safe zone is the inner 80% circle, and the mark fills 89% of the source's width — the
    // launcher mask would clip it. Reusing one file for both purposes is the usual shortcut here
    // and it is the reason so many installed apps have a shaved-off logo.
    const any = manifest.icons.filter((i: { purpose?: string }) => i.purpose === 'any');
    const maskable = manifest.icons.filter((i: { purpose?: string }) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThan(0);
    for (const m of maskable) {
      expect(any.map((a: { src: string }) => a.src)).not.toContain(m.src);
    }
  });

  it('the apple-touch-icon has no alpha channel', () => {
    // ⛔ iOS composites a transparent home-screen icon onto BLACK — the favicon has alpha, so
    // reusing it would put the violet mark on a black tile. Colour type 2 = RGB, no alpha.
    expect(png('public/apple-touch-icon.png').colorType).toBe(2);
    expect(png('public/icon-maskable-512.png').colorType).toBe(2);
  });
});

describe('SQEM-361 — index.html wires it up', () => {
  it('links the manifest as .json, not .webmanifest', () => {
    // ⚠️ Self-host serves the bundle from `nginx:1.27-alpine`, whose mime.types has no mapping for
    // `.webmanifest`; it would go out as application/octet-stream. The failure would appear only
    // there — the one environment we do not look at after every deploy.
    expect(INDEX).toMatch(/<link rel="manifest" href="\/manifest\.json"/);
    expect(INDEX).not.toMatch(/\.webmanifest/);
  });

  it('declares the iOS pieces', () => {
    expect(INDEX).toMatch(/rel="apple-touch-icon"/);
    expect(INDEX).toMatch(/name="mobile-web-app-capable"/);
  });

  it('has a theme colour for each colour scheme', () => {
    // A manifest carries one `theme_color`; the app has two themes. These override it per scheme.
    expect(INDEX).toMatch(/theme-color"[^>]*prefers-color-scheme: light/);
    expect(INDEX).toMatch(/theme-color"[^>]*prefers-color-scheme: dark/);
  });
});

describe('SQEM-361 — no service worker, on purpose', () => {
  /**
   * ⛔ This is the assertion to read before adding one.
   *
   * Chrome's install prompt wants a worker with a fetch handler, so leaving it out has a real cost:
   * no automatic install prompt on Android. It is still the right trade today. SQEM-301 exists
   * because a replaced lazy chunk after a deploy produced "Something went wrong" — a caching worker
   * makes that class worse and much harder to diagnose, because a stale registration keeps serving
   * old code until the user intervenes. And there is no offline capability to buy in exchange.
   *
   * If that changes, the answer is a **network-first** worker that falls back only to an offline
   * page and never serves a stale bundle — and then this test should be replaced by one that pins
   * *that*, not simply deleted.
   */
  it('registers no service worker anywhere in the app', () => {
    const scan = (dir: string): string[] => readdirSync(root(dir), { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? scan(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
      .filter((f) => /\.(ts|tsx|js|html)$/.test(f));
    const files = ['components', 'pages', 'lib', 'public'].flatMap(scan).concat(['index.html', 'App.tsx']);
    const offenders = files.filter((f) => /serviceWorker\.register|navigator\.serviceWorker/.test(readFileSync(root(f), 'utf8')));
    expect(offenders, `service worker registered in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('ships no worker file to be registered', () => {
    for (const f of ['public/sw.js', 'public/service-worker.js', 'public/workbox-sw.js']) {
      expect(existsSync(root(f)), `${f} exists — see the note above before keeping it`).toBe(false);
    }
  });
});
