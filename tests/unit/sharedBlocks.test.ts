import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { en } from './i18nText';

/**
 * SQEM-554 (a) — the shared blocks in redesign C's look: EmptyState, Modal/ConfirmModal, the loading
 * states and the toasts. Source-level, because App.tsx and the pages import the store.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const app = read('App.tsx');

describe('SQEM-554 (a) — EmptyState', () => {
  const src = read('components/ui/EmptyState.tsx');
  it('owns its tile: a `tone` prop instead of a class from the caller; display-face title', () => {
    expect(src).toMatch(/brand: 'bg-accent-soft text-accent'/);
    expect(src).toMatch(/neutral: 'bg-surface-sunken text-ink-subtle'/);
    expect(src).toMatch(/<h3 className="font-display text-xl font-semibold text-ink-strong">\{title\}<\/h3>/);
    expect(src).not.toMatch(/iconWrapClassName/);
  });
  it('no caller passes a tile class any more; the "create your first" ones use tone="brand"', () => {
    for (const p of ['pages/Templates.tsx', 'pages/Personas.tsx', 'pages/Files.tsx', 'pages/DesignSystem.tsx']) {
      expect(read(p), p).not.toMatch(/iconWrapClassName/);
    }
    for (const p of ['pages/Templates.tsx', 'pages/Personas.tsx', 'pages/Files.tsx']) {
      expect(read(p), p).toMatch(/tone="brand"/);
    }
  });
});

describe('SQEM-554 (a) — dialogs', () => {
  it('Modal uses the dialog tokens', () => {
    expect(read('components/ui/Modal.tsx')).toMatch(/'bg-surface-raised rounded-overlay shadow-overlay border border-line animate-scale-up w-full'/);
  });
  it('ConfirmModal: display-face title; Cancel stays the QUIET plain button (deliberate), now on tokens', () => {
    const src = read('components/ui/ConfirmModal.tsx');
    expect(src).toMatch(/<h3 className="font-display text-xl font-semibold text-ink-strong mb-2">\{title\}<\/h3>/);
    expect(src).toMatch(/<button\s+onClick=\{close\}[\s\S]{0,80}className="flex-1 py-2\.5 text-ink-muted bg-surface-sunken/);
    expect(src).not.toMatch(/slate-|red-400|red-500/);
  });
});

describe('SQEM-554 (a) — loading and toasts', () => {
  it('"Loading…" with an ellipsis, no pulse for reduced motion, surface background', () => {
    expect(app).toMatch(/>\{m\.app_loading\(\)\}<\/p>/);
    expect(en.app_loading).toBe('Loading…'); // SQEM-611
    expect(app).not.toMatch(/Loading\.\.\./);
    expect(app).not.toMatch(/[^:]animate-pulse/);
    expect(app).not.toMatch(/bg-slate-50 dark:bg-slate-900/);
  });
  it('toast = a light card (choice A); the type is the icon colour; alert/status roles unchanged', () => {
    expect(app).toMatch(/rounded-card border bg-surface-raised text-ink-strong shadow-raised/);
    expect(app).toMatch(/toast\.type === 'error' \? 'border-danger\/40' : 'border-line'/);
    expect(app).toMatch(/<CheckCircle aria-hidden className="w-5 h-5 text-success/);
    expect(app).toMatch(/<AlertTriangle aria-hidden className="w-5 h-5 text-danger/);
    expect(app).toMatch(/<Info aria-hidden className="w-5 h-5 text-accent/);
    expect(app).toMatch(/role=\{isAlert \? 'alert' : 'status'\}/);
    expect(app).not.toMatch(/bg-blue-500|bg-red-500|bg-slate-900/);
  });

  // Contrast from the real token values (SQEM-537 checks pages; this checks the toast's pairs).
  const css = read('index.css');
  const blocks = [...css.matchAll(/(^|\n)(:root|\.dark)\s*\{([\s\S]*?)\n\}/g)].map(m => ({ sel: m[2], body: m[3] }));
  const resolveVar = (body: string, name: string, depth = 0): number[] => {
    // Only this mode's blocks — no fallback to the whole file, or dark would silently test light.
    const m = body.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`no --${name} in this mode`);
    const v = m[1].trim();
    const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
    if (ref && depth < 4) return resolveVar(body, ref[1], depth + 1);
    return v.split(/\s+/).map(Number);
  };
  const lum = ([r, g, b]: number[]) => {
    const c = [r, g, b].map(x => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  for (const mode of [':root', '.dark']) {
    it(`toast contrast in ${mode === ':root' ? 'light' : 'dark'} mode: text ≥ 4.5, icons ≥ 3`, () => {
      const body = blocks.filter(b => b.sel === mode).map(b => b.body).join('\n');
      const bg = resolveVar(body, 'c-surface-raised');
      expect(ratio(resolveVar(body, 'c-ink-strong'), bg)).toBeGreaterThanOrEqual(4.5);
      for (const icon of ['c-success', 'c-danger', 'c-accent']) {
        expect(ratio(resolveVar(body, icon), bg), icon).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
