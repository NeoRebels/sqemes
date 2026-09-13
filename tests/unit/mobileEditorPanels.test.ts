import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-387 — the editors' side rails must scroll on a phone.
 *
 * ⛔ They are laid out `flex-col xl:flex-row` inside an `overflow-hidden` shell. `shrink-0` is right
 * for the row (holds the rail's width) and wrong for the column: the rail grows to its content, the
 * shell clips it, `overflow-y-auto` has nothing to scroll. Owner's finding on staging, 2026-09-12.
 * The pages import the store and Supabase and cannot be rendered here; this reads the three rails.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const RAILS: [string, string][] = [
  ['pages/TemplateEditor.tsx', "mobileTab === 'settings'"],
  ['pages/TemplateEditor.tsx', "mobileTab === 'test' ? 'flex flex-col'"],
  ['pages/PersonaEditor.tsx', "mobileTab === 'details'"],
  ['pages/PersonaEditor.tsx', "mobileTab === 'routes'"],
];

/**
 * The rail's opening tag. ⚠️ The tab BUTTONS carry the same `mobileTab === '…'` marker, and they
 * come first in the file — the first cut of this test asserted on a button and went red on the
 * correct code. A rail is the occurrence whose tag also names an `xl:w-[…]` width.
 */
function railClassList(file: string, tabMarker: string): string {
  const src = read(file);
  let from = 0;
  for (;;) {
    const at = src.indexOf(tabMarker, from);
    expect(at, `${file}: rail with ${tabMarker}`).toBeGreaterThan(-1);
    const open = src.lastIndexOf('<div className=', at);
    const tag = src.slice(open, at);
    if (/xl:w-\[/.test(tag)) return tag;
    from = at + tabMarker.length;
  }
}

describe('⛔ SQEM-387 (follow-up) — the editor+test wrapper leaves the phone when the settings rail is up', () => {
  it('the wrapper is hidden below xl while mobileTab is settings', () => {
    const src = read('pages/TemplateEditor.tsx');
    // Its children were hidden already; the wrapper itself stayed as an empty flex-1 sibling and
    // took half the height from the settings rail.
    expect(src).toMatch(/flex-1 overflow-hidden min-w-0 \$\{mobileTab === 'settings' \? 'hidden xl:flex' : 'flex'\}/);
    expect(src).not.toMatch(/className="flex-1 flex overflow-hidden min-w-0"/);
  });
});

describe('⛔ SQEM-387 — every editor rail fills the remaining height on a phone and keeps its width on xl', () => {
  for (const [file, marker] of RAILS) {
    it(`${file} — ${marker}`, () => {
      const cls = railClassList(file, marker);
      // Either scrolls itself or hosts a scrolling child (the test panel) — both need the bound.
      expect(cls).toMatch(/overflow-(y-auto|hidden)/);
      // The fix: bounded height below xl …
      expect(cls).toMatch(/\bflex-1\b/);
      expect(cls).toMatch(/\bmin-h-0\b/);
      // … fixed width on xl …
      expect(cls).toMatch(/\bxl:flex-none\b/);
      // … and never the bare `shrink-0` that made the column grow past the shell.
      expect(cls).not.toMatch(/(^|\s)shrink-0(\s|$)/);
    });
  }
});
