import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { toolCapNotice } from '../../supabase/functions/_shared/libraryTools';
import { normalizeLocale } from '../../supabase/functions/_shared/locale';

/**
 * SQEM-599 — the German UI (epic SQEM-407) rests on four properties. Each is what keeps Paraglide
 * replaceable, or the translation honest, and each fails silently if nobody checks it.
 */
const ROOT = resolve(__dirname, '../..');
const OUTPUT = join(ROOT, 'supabase/functions/_shared/i18n');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'coverage', 'selfhost', 'publish'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Real import specifiers only — the generated runtime carries example imports in its comments. */
function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)]
    .map(x => x[1] ?? x[2]);
}

describe('SQEM-599 — one seam per side', () => {
  // ⛔ The exit from Paraglide is two files, not two thousand. Build tooling (the config, the compile
  // script, vite.config.ts) is allowed to know the compiler; application code is not.
  const SEAMS = ['lib/i18n.ts', 'supabase/functions/_shared/locale.ts'];
  const TOOLING = ['i18n.config.mjs', 'scripts/i18n-compile.mjs', 'vite.config.ts'];

  it('only the seams import the generated output or @inlang/paraglide-js', () => {
    const offenders = walk(ROOT)
      .map(p => relative(ROOT, p))
      .filter(p => !p.startsWith('supabase/functions/_shared/i18n/') && !p.startsWith('tests/'))
      .filter(p => !SEAMS.includes(p) && !TOOLING.includes(p))
      .filter(p => importSpecifiers(readFileSync(join(ROOT, p), 'utf8'))
        .some(s => s.includes('@inlang/') || /(^|\/)_shared\/i18n\//.test(s) || /^\.\/i18n\//.test(s)));
    expect(offenders).toEqual([]);
  });
});

describe('SQEM-599 — the committed output stands on its own', () => {
  it('imports nothing but its own files (no npm package, no node: builtin)', () => {
    const bare = walk(OUTPUT)
      .flatMap(p => importSpecifiers(readFileSync(p, 'utf8')).map(s => ({ file: relative(OUTPUT, p), s })))
      .filter(({ s }) => !s.startsWith('./') && !s.startsWith('../'));
    expect(bare).toEqual([]);
  });
});

describe('SQEM-599 — the texts are plain JSON and German is complete', () => {
  // A message is a string, or (SQEM-604) a variant list — Paraglide's form for plurals:
  // [{ declarations, selectors, match: { "countPlural=one": "…", "countPlural=other": "…" } }].
  type Variant = { declarations: string[]; selectors: string[]; match: Record<string, string> };
  type Message = string | Variant[];
  const read = (locale: string) => JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), 'utf8')) as Record<string, Message>;
  const keys = (o: Record<string, Message>) => Object.keys(o).filter(k => k !== '$schema');
  /** Every text a message can show — one for a string, one per variant otherwise. */
  const texts = (v: Message | undefined): string[] =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(x => Object.values(x?.match ?? {})) : [];

  /** Keys with no German text — empty counts as missing, in any variant. */
  const missingIn = (base: Record<string, Message>, other: Record<string, Message>) =>
    keys(base).filter(k => { const t = texts(other[k]); return !t.length || t.some(x => typeof x !== 'string' || !x.trim()); });

  it('both files are flat key → message maps, readable without Paraglide', () => {
    for (const locale of ['en', 'de']) {
      const o = read(locale);
      for (const k of keys(o)) {
        expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
        const v = o[k];
        if (typeof v === 'string') continue;
        // A variant list: plain data, one level deep, every branch a string.
        expect(Array.isArray(v), k).toBe(true);
        for (const x of v) {
          expect(Array.isArray(x.declarations) && Array.isArray(x.selectors), k).toBe(true);
          expect(Object.values(x.match).every(t => typeof t === 'string'), k).toBe(true);
        }
      }
    }
  });

  it('detects a missing German text', () => {
    expect(missingIn({ a: 'A', b: 'B' }, { a: 'A' })).toEqual(['b']);
    expect(missingIn({ a: 'A' }, { a: '  ' })).toEqual(['a']);
    const plural = (one: string, other: string): Message => [{ declarations: [], selectors: [], match: { one, other } }];
    expect(missingIn({ p: plural('1 file', 'n files') }, { p: plural('1 Datei', ' ') })).toEqual(['p']);
  });

  // ⚠️ Strict on purpose: a key is added in BOTH files in the same change. German ships only when
  // everything is translated, and the cheapest moment to translate is now.
  it('every English text has a German one, and no German text is orphaned', () => {
    const en = read('en'), de = read('de');
    expect(missingIn(en, de)).toEqual([]);
    expect(missingIn(de, en)).toEqual([]);
  });

  // SQEM-605 — `{{variable_name}}` in a text compiles to a placeholder named "{variable_name" and renders
  // "undefined}". A literal brace pair is passed in as a value instead (`{token}` → '{{variable_name}}').
  it('no text contains a double brace — Paraglide would read it as a placeholder', () => {
    for (const locale of ['en', 'de']) {
      const o = read(locale);
      const bad = keys(o).filter(k => texts(o[k]).some(t => /\{\{|\}\}/.test(t)));
      expect([locale, bad]).toEqual([locale, []]);
    }
  });

  it('placeholders match between the languages', () => {
    const en = read('en'), de = read('de');
    const vars = (v: Message | undefined) => [...new Set(texts(v).flatMap(s => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1])))].sort();
    for (const k of keys(en)) expect([k, vars(de[k])]).toEqual([k, vars(en[k])]);
  });
});

describe('SQEM-599 — a server notice in the language the client asked for', () => {
  it('normalises anything unknown to English', () => {
    expect(normalizeLocale('de')).toBe('de');
    for (const v of ['en', 'fr', '', undefined, null, 42, 'DE']) expect(normalizeLocale(v)).toBe('en');
  });

  it('toolCapNotice speaks German for de and English otherwise', () => {
    expect(toolCapNotice(6, 'rounds', 'de')).toContain('nach 6 Runden');
    expect(toolCapNotice(6, 'time', 'de')).toMatch(/keine Zeit mehr/);
    expect(toolCapNotice(6, 'rounds')).toContain('stopped after 6 rounds');
    expect(toolCapNotice(6, 'rounds', 'en')).toBe(toolCapNotice(6, 'rounds'));
  });
});
