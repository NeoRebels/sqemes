import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SQEM-537 — the muted text colours meet WCAG AA (4.5:1) on the surfaces they sit on, in both
 * themes, and the scale keeps its order (400 lighter than 500 lighter than 600 in dark; the reverse
 * relation to the background in light). SQEM-202 fixed light and left dark at #6b7280 with a
 * comment calling it "ausreichend" — 3.0:1. This recomputes the numbers from `index.css`, so a
 * value cannot drift back without a red test.
 */
const ROOT = resolve(__dirname, '../..');
const css = readFileSync(join(ROOT, 'index.css'), 'utf8');

const block = (selector: string) => {
  const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`no ${selector} block`);
  return m[1];
};
const rgbVar = (body: string, name: string): [number, number, number] => {
  const m = body.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!m) throw new Error(`no --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const hex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

const lum = ([r, g, b]: [number, number, number]) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Fixed values, READ from tailwind.config.js (SQEM-547 retinted them; a copy here would test the old
// greys against the new text and pass for the wrong reason).
// Only the `slate: { … }` block — `brand` has the same step names and comes first.
const CFG = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8').split(/\bslate: \{/)[1].split('}')[0];
const slateStep = (step: number) => {
  const m = CFG.match(new RegExp(`\\b${step}:\\s*'(#[0-9a-f]{6})'`));
  if (!m) throw new Error(`slate-${step} not found in tailwind.config.js`);
  return hex(m[1]);
};
const SLATE_100 = slateStep(100);
const SLATE_600 = slateStep(600);
const SLATE_800 = slateStep(800);
const SLATE_900 = slateStep(900);
const WHITE: [number, number, number] = [255, 255, 255];

describe('SQEM-537 — muted text meets AA in both themes', () => {
  const dark = block('.dark');
  const light = block(':root');

  it.each(['c-slate-400', 'c-slate-500'])('dark %s ≥ 4.5:1 on slate-800 and slate-900', name => {
    const c = rgbVar(dark, name);
    expect(ratio(c, SLATE_800)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c, SLATE_900)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['c-slate-400', 'c-slate-500'])('light %s ≥ 4.5:1 on white and slate-100', name => {
    const c = rgbVar(light, name);
    expect(ratio(c, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c, SLATE_100)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark keeps the order: 400 lighter than 500 lighter than 600', () => {
    expect(lum(rgbVar(dark, 'c-slate-400'))).toBeGreaterThan(lum(rgbVar(dark, 'c-slate-500')));
    expect(lum(rgbVar(dark, 'c-slate-500'))).toBeGreaterThan(lum(SLATE_600));
  });
});

describe('SQEM-537 — the pages that had no dark mode', () => {
  it.each(['pages/NotFound.tsx', 'pages/InviteAccept.tsx', 'components/ErrorBoundary.tsx'])(
    '%s: every white or slate-50 surface has a dark counterpart', file => {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      for (const [, cls] of src.matchAll(/className="([^"]*)"/g)) {
        const toks = cls.split(/\s+/);
        if (toks.includes('bg-white') || toks.includes('bg-slate-50')) {
          expect(toks.some(t => t.startsWith('dark:bg-')), cls).toBe(true);
        }
        if (toks.includes('text-slate-900')) expect(toks.some(t => t.startsWith('dark:text-')), cls).toBe(true);
      }
    });
});
