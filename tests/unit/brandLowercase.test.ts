import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * SQEM-558 — the brand is "sqemes", capitalised only at the start of a sentence.
 * Scans text a person reads — UI strings, auth mails, edge-function messages, the public self-host docs —
 * for "Sqemes" right after a lowercase word, a comma or an opening quote inside a sentence.
 * Identifiers (SqemesFoo), imports and comments are not text and are skipped.
 */
const ROOT = resolve(__dirname, '../..');
const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
  const p = join(d, n);
  if (n === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|html|md)$/.test(n) && !n.endsWith('.d.ts') ? [p] : [];
});
const roots = ['pages', 'components', 'lib', 'supabase/templates', 'supabase/functions', 'publish']
  .map(r => join(ROOT, r)).filter(existsSync);
const files = [...roots.flatMap(walk), join(ROOT, 'App.tsx'), join(ROOT, 'constants.ts'), join(ROOT, 'SELF_HOSTING.md')].filter(existsSync);

describe('SQEM-558 — "sqemes" in lowercase mid-sentence', () => {
  it('no "Sqemes" after a lowercase word, a comma, or a quote opened inside a sentence', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = /\.tsx?$/.test(f);
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (code && /^(\/\/|\*|\/\*|\{\/\*|import )/.test(t)) return;
        for (const m of line.matchAll(/(?<![A-Za-z0-9_\-/.@])Sqemes(?![A-Za-z0-9_])/g)) {
          const pre = line.slice(0, m.index).replace(/\s+$/, '');
          if (code) { // a trailing comment: "//" with an even number of quotes before it (outside any string)
            const c = pre.indexOf('//');
            if (c >= 0 && (pre.slice(0, c).match(/['"`]/g) ?? []).length % 2 === 0) continue;
          }
          if (/[a-z0-9,;]$/.test(pre) || /[a-z]\s+["“‘']$/.test(line.slice(0, m.index))) offenders.push(`${relative(ROOT, f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
