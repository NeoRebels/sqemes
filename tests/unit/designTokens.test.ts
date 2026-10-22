import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * SQEM-545 — the webapp's design system, J1: semantic tokens, one type scale, radius/elevation roles,
 * and a guard that lets the off-system classes only shrink.
 *
 * ⚠️ Walks the file system, not `git ls-files` — exported to the self-host repo.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const css = read('index.css');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}
const SOURCES = [...files(join(ROOT, 'pages')), ...files(join(ROOT, 'components')), join(ROOT, 'App.tsx')];

const block = (sel: string) => {
  const re = new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g');
  return [...css.matchAll(re)].map(m => m[2]).join('\n');
};
const triplet = (body: string, name: string) => {
  const m = body.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  return m ? `${m[1]} ${m[2]} ${m[3]}` : null;
};

// Every token was the pair the code used most often before SQEM-545 (counted). SQEM-547 retinted the
// slate scale for redesign C, so the slate-based tokens moved WITH it — each still equals the slate
// step it replaced (now the tinted one in tailwind.config.js); brand and the status colours are
// Tailwind's defaults and did not change.
const EXPECTED: Record<string, [string, string]> = {
  'c-surface': ['248 247 251', '20 16 38'],          // slate-50 / slate-900
  'c-surface-raised': ['255 255 255', '29 25 50'],   // white / slate-800
  'c-surface-sunken': ['241 238 246', '44 39 66'],   // slate-100 / slate-700
  'c-surface-field': ['255 255 255', '44 39 66'],    // white / slate-700
  'c-line': ['241 238 246', '44 39 66'],             // slate-100 / slate-700
  'c-line-strong': ['230 226 238', '74 68 98'],      // slate-200 / slate-600
  'c-ink-strong': ['20 16 38', '241 238 246'],       // slate-900 / slate-100
  'c-ink': ['44 39 66', '230 226 238'],              // slate-700 / slate-200
  'c-accent': ['147 51 234', '192 132 252'],
  'c-accent-strong': ['147 51 234', '147 51 234'],
  'c-danger': ['220 38 38', '248 113 113'],
  'c-warning': ['217 119 6', '251 191 36'],
  'c-success': ['5 150 105', '52 211 153'],
  'c-skill': ['15 118 110', '94 196 182'],           // SQEM-547 — petrol, the skill kind
};

const lum = (rgb: number[]) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(rgb[0]) + 0.7152 * c(rgb[1]) + 0.0722 * c(rgb[2]);
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const nums = (t: string) => t.split(' ').map(Number);

describe('SQEM-545 — semantic tokens', () => {
  const light = block(':root');
  const dark = block('.dark');

  it.each(Object.entries(EXPECTED))('%s keeps the value it replaced, in both themes', (name, [l, d]) => {
    expect(triplet(light, name), `light ${name}`).toBe(l);
    expect(triplet(dark, name), `dark ${name}`).toBe(d);
  });

  it('muted and subtle text follow the themed slate variables (their AA is guarded by darkContrast)', () => {
    expect(light).toMatch(/--c-ink-muted: var\(--c-slate-500\);/);
    expect(light).toMatch(/--c-ink-subtle: var\(--c-slate-400\);/);
    expect(triplet(dark, 'c-ink-muted')).toBe(triplet(dark, 'c-slate-400'));
    expect(triplet(dark, 'c-ink-subtle')).toBe(triplet(dark, 'c-slate-500'));
  });

  it('strong and body text meet AA on every surface they sit on', () => {
    for (const [theme, body] of [['light', light], ['dark', dark]] as const) {
      for (const text of ['c-ink-strong', 'c-ink']) {
        for (const surface of ['c-surface', 'c-surface-raised']) {
          expect(ratio(nums(triplet(body, text)!), nums(triplet(body, surface)!)), `${theme} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('the primitives in components/ui no longer spell out the pairs a token replaces', () => {
    const pairs = [/text-slate-500 dark:text-slate-400/, /text-slate-900 dark:text-slate-100/, /bg-white dark:bg-slate-800/, /border-slate-100 dark:border-slate-700/];
    const ui = files(join(ROOT, 'components/ui'));
    for (const f of ui) for (const p of pairs) expect(readFileSync(f, 'utf8'), `${relative(ROOT, f)} ${p}`).not.toMatch(p);
  });
});

describe('SQEM-545 — scales', () => {
  const tw = read('tailwind.config.js');

  it('the type scale has no 3xs, and no page uses a retired or arbitrary size', () => {
    expect(tw).not.toMatch(/'3xs'/);
    const offenders = SOURCES.flatMap(f => {
      const s = readFileSync(f, 'utf8');
      return [...s.matchAll(/\btext-(3xs|4xl|5xl|6xl|\[\d+px\])/g)].map(m => `${relative(ROOT, f)}: ${m[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('radius and elevation roles exist as aliases of the values in use', () => {
    expect(tw).toMatch(/chip: '0\.5rem'/);
    expect(tw).toMatch(/control: '0\.75rem'/);
    expect(tw).toMatch(/card: '1rem'/);
    expect(tw).toMatch(/overlay: '1rem'/);
    expect(tw).toMatch(/rest: '0 2px 10px rgba\(0, 0, 0, 0\.03\)'/);
  });
});

describe('SQEM-545 — off-system classes may only shrink', () => {
  const baseline = JSON.parse(read('tests/unit/designBaseline.json')) as Record<string, Record<string, number> | string>;
  const OFF = /(?:bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|divide|placeholder|decoration|accent|caret)-(indigo|sky|violet|blue|rose|green|purple|gray|zinc|neutral|stone|lime|teal|cyan|fuchsia|pink|orange|yellow)-\d/g;

  it('no file uses a colour family outside the palette more often than the baseline allows', () => {
    const over: string[] = [];
    for (const f of SOURCES) {
      const rel = relative(ROOT, f);
      const allowed = (typeof baseline[rel] === 'object' ? baseline[rel] : {}) as Record<string, number>;
      const counts: Record<string, number> = {};
      for (const m of readFileSync(f, 'utf8').matchAll(OFF)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
      for (const [fam, n] of Object.entries(counts)) if (n > (allowed[fam] ?? 0)) over.push(`${rel}: ${fam} ${n} > ${allowed[fam] ?? 0}`);
    }
    expect(over).toEqual([]);
  });

  it('no arbitrary hex colours in class names', () => {
    const offenders = SOURCES.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/g)].map(m => `${relative(ROOT, f)}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });
});

describe('SQEM-547 — the tokens follow the tinted slate scale', () => {
  // Only the `slate: { … }` block — `brand` has the same step names and comes first.
  const cfg = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8').split(/\bslate: \{/)[1].split('}')[0];
  const slate = (step: string) => {
    const m = cfg.match(new RegExp(`\\b${step}:\\s*'#([0-9a-f]{6})'`));
    if (!m) throw new Error(`slate-${step} not found`);
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).join(' ');
  };
  it.each([
    ['c-surface', '50', '900'], ['c-surface-sunken', '100', '700'], ['c-line', '100', '700'],
    ['c-line-strong', '200', '600'], ['c-ink-strong', '900', '100'], ['c-ink', '700', '200'],
  ])('%s = slate-%s (light) / slate-%s (dark)', (name, l, d) => {
    expect(EXPECTED[name]).toEqual([slate(l), slate(d)]);
  });
});

