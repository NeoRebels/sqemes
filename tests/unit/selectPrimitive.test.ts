import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * SQEM-601 — one form field select. Before it: 15 hand-styled selects in 11 variants, six in the
 * pre-redesign palette, two without an arrow. This test is what keeps it at one.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * The selects outside components/ui that are deliberately NOT the form field:
 * - Settings: the member list's role pill — compact, uppercase, inline in a table row;
 * - Files: the sort select, a toolbar control that mirrors ui/SelectFilter beside it.
 * (Inside components/ui, TagEditor and BulkActionBar keep their own compact selects, and
 * SelectFilter is the toolbar primitive.)
 */
const EXCEPTIONS = new Set(['pages/Settings.tsx', 'pages/Files.tsx']);
const EXCEPTION_COUNT: Record<string, number> = { 'pages/Settings.tsx': 1, 'pages/Files.tsx': 1 };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function nativeSelects(file: string): number {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let n = 0;
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'select') n++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

describe('SQEM-601 — no hand-styled select outside components/ui', () => {
  it('pages and components use ui/Select (or a named exception)', () => {
    const offenders = [...walk(join(ROOT, 'pages')), ...walk(join(ROOT, 'components'))]
      .map(p => relative(ROOT, p))
      .filter(p => !p.startsWith('components/ui/'))
      .map(p => ({ p, n: nativeSelects(join(ROOT, p)) }))
      .filter(({ p, n }) => n > (EXCEPTIONS.has(p) ? EXCEPTION_COUNT[p] : 0))
      .map(({ p, n }) => `${p}: ${n}`);
    expect(offenders).toEqual([]);
  });

  it('the named exceptions are still there (or the list is stale)', () => {
    for (const p of EXCEPTIONS) expect([p, nativeSelects(join(ROOT, p))]).toEqual([p, EXCEPTION_COUNT[p]]);
  });
});

describe('SQEM-601 — the primitive', () => {
  const src = read('components/ui/Select.tsx');
  // The class constant itself — the header comment names the old palette on purpose.
  const field = src.match(/const fieldClasses =\s*'([^']+)'/)?.[1] ?? '';
  it('always draws its own arrow, because appearance-none removes the browser’s', () => {
    expect(field).toMatch(/appearance-none/);
    expect(src).toMatch(/<ChevronDown aria-hidden/);
  });
  it('uses the design tokens, not the pre-redesign palette', () => {
    expect(field).toMatch(/bg-surface-field border border-line-strong text-ink-strong/);
    expect(field).toMatch(/focus:border-accent focus:ring-2 focus:ring-accent\/20/);
    expect(field).not.toMatch(/slate-|bg-white|brand-/);
  });
  it('dark mode gets a dark option list', () => {
    expect(field).toMatch(/dark:\[color-scheme:dark\]/);
  });
  it('is as tall as ui/Input (py-3)', () => {
    expect(field).toMatch(/ py-3 /);
    expect(read('components/ui/Input.tsx')).toMatch(/px-4 py-3/);
  });
});
