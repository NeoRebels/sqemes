import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { moveItem } from '../../lib/moveItem';
import MoveButtons from '../../components/ui/MoveButtons';

/**
 * SQEM-540 — touch and keyboard: nothing appears on hover only, small icons get a 24 px target, and
 * a list that can be reordered by dragging can be reordered without dragging too.
 *
 * ⚠️ Walks the file system, not `git ls-files` — this test is exported to the self-host repo.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = resolve(__dirname, '../..');
const css = readFileSync(join(ROOT, 'index.css'), 'utf8');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('SQEM-540 — the two helper classes', () => {
  it('reveal-on-hover: hidden at rest, shown on group hover, on focus inside, and always without hover', () => {
    expect(css).toMatch(/\.reveal-on-hover \{ opacity: 0; \}/);
    expect(css).toMatch(/\.group:hover \.reveal-on-hover/);
    expect(css).toMatch(/\.group:focus-within \.reveal-on-hover/);
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.reveal-on-hover \{ opacity: 1; \}/);
  });

  it('hit-24: an ::after of at least 24 × 24, centred', () => {
    expect(css).toMatch(/\.hit-24::after \{[^}]*width: max\(100%, 24px\);[^}]*height: max\(100%, 24px\);/);
  });

  it('no hover-only reveal is left in the components (the two decorative overlays excepted)', () => {
    const allowed = ['pages/Settings.tsx', 'pages/Chat.tsx'];
    const offenders = [...tsxFiles(join(ROOT, 'pages')), ...tsxFiles(join(ROOT, 'components'))]
      .map(f => [relative(ROOT, f), readFileSync(f, 'utf8')] as const)
      .flatMap(([f, src]) => src.split('\n')
        .filter(l => /opacity-0 group-hover(\/\w+)?:opacity-100/.test(l))
        // The avatar's camera overlay (the whole avatar is the button) and a pointer-events-none tooltip.
        // SQEM-554 (d4): the overlay's class is the token `bg-ink-strong/50` now (was `bg-slate-900/50`).
        .filter(l => !(allowed.includes(f) && /(bg-ink-strong\/50 rounded-full|pointer-events-none)/.test(l)))
        .map(l => `${f}: ${l.trim().slice(0, 80)}`));
    expect(offenders).toEqual([]);
  });
});

describe('SQEM-540 — moveItem', () => {
  it('moves an entry and leaves the input alone', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('out of range or no-op returns a copy unchanged', () => {
    const list = [1, 2, 3];
    expect(moveItem(list, 0, 3)).toEqual([1, 2, 3]);
    expect(moveItem(list, -1, 0)).toEqual([1, 2, 3]);
    expect(moveItem(list, 1, 1)).not.toBe(list);
  });
});

describe('SQEM-540 — MoveButtons', () => {
  let root: Root; let host: HTMLDivElement; let onMove: Mock<(to: number) => void>;
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); onMove = vi.fn<(to: number) => void>(); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  const btn = (name: string) => host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;

  it('names the item, disables the edge, and moves by one', () => {
    act(() => root.render(React.createElement(MoveButtons, { label: 'Sales', index: 0, count: 3, onMove })));
    expect(btn('Move Sales up').disabled).toBe(true);
    expect(btn('Move Sales down').disabled).toBe(false);
    act(() => { btn('Move Sales down').click(); });
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it('is wired into both editors', () => {
    expect(readFileSync(join(ROOT, 'pages/TemplateEditor.tsx'), 'utf8')).toMatch(/<MoveButtons label=\{v\.label \|\| v\.name\} index=\{vi\}/);
    expect(readFileSync(join(ROOT, 'pages/PersonaEditor.tsx'), 'utf8')).toMatch(/onMove=\{to => moveRoute\(i, to\)\}/);
  });
});
