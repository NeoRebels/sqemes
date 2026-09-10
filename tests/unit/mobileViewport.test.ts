import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldSendOnEnter } from '../../lib/chatKeys';

/**
 * SQEM-360 — the four fixes that live in shared code, pinned where they can drift back.
 *
 * ⛔ The reason this file exists at all is the fifth finding: `ScrollScreen` (SQEM-099) was written
 * for four pages, **names all four in its own doc comment**, and had been applied to two. Nothing
 * checked, so nothing said. Documenting the contract again would repeat the same mistake with more
 * words; the tests below are the contract.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

/**
 * Strip comments — several of these files quote the old, broken markup to explain why it went, and
 * that prose must not satisfy or break an assertion meant for the code.
 *
 * ⚠️ **Line comments first, and that order is not cosmetic.** `TemplateEditor.tsx` has the line
 * `// marketplace templates (/library/*)`. Removing block comments first turns that stray `/*` into
 * the opening of one and swallows the next 450 lines — including the `h-dvh` this file asserts on.
 * It cost a false failure here before the order was fixed; other tests in this repo use the same
 * helper in the other order and have simply never met a source that trips it.
 */
function code(src: string): string {
  return src
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('SQEM-360 — Enter sends only where Shift+Enter exists', () => {
  const enter = { key: 'Enter', shiftKey: false };
  const shiftEnter = { key: 'Enter', shiftKey: true };

  it('sends on Enter with a mouse and keyboard', () => {
    expect(shouldSendOnEnter(enter, false)).toBe(true);
  });

  it('does NOT send on Enter with a touch keyboard — that key has to make a line break', () => {
    // The whole bug: a touch keyboard has no Shift+Enter, so binding Enter to send left no way at
    // all to write a paragraph. The send button beside the field is the send affordance there.
    expect(shouldSendOnEnter(enter, true)).toBe(false);
  });

  it('never sends on Shift+Enter', () => {
    expect(shouldSendOnEnter(shiftEnter, false)).toBe(false);
    expect(shouldSendOnEnter(shiftEnter, true)).toBe(false);
  });

  it('ignores every other key', () => {
    for (const key of ['a', 'Escape', 'Tab', '/', 'NumpadEnter']) {
      expect(shouldSendOnEnter({ key, shiftKey: false }, false)).toBe(false);
    }
  });
});

describe('SQEM-360 — the Modal primitive can be scrolled to', () => {
  const MODAL = code(read('components/ui/Modal.tsx'));

  it('the overlay is a scroll container', () => {
    // Without this a dialog taller than the viewport is centred and cut off at BOTH ends, with
    // nothing to scroll — `position: fixed` does not scroll with the page.
    expect(MODAL).toMatch(/fixed inset-0[^'"`]*overflow-y-auto/);
  });

  it('centring happens in an inner min-h-full wrapper, not on the overlay', () => {
    // `items-center` directly on the scroll container makes the TOP overflow unreachable rather
    // than merely hidden. The `min-h-full` wrapper keeps short dialogs centred and lets tall ones
    // grow past the fold instead.
    expect(MODAL).toMatch(/min-h-full[^'"`]*items-center/);
  });

  it('adds no height utility of its own', () => {
    // Deliberate, and the reason is concrete: four call sites pass their own `max-h-[80vh]`/`85vh`
    // through `className`. Two competing `max-h-*` utilities have equal specificity, so which one
    // won would depend on the order Tailwind emits them. Adding one here would make those four
    // dialogs unpredictable to fix a problem the scroll container already solves.
    expect(MODAL).not.toMatch(/max-h-/);
  });
});

describe('SQEM-360 — full-screen shells use the visible viewport', () => {
  // `100vh` on iOS is the LARGE viewport, measured with the browser toolbar collapsed. Anything
  // pinned to the bottom of an `h-screen` shell — the chat composer, an editor's action bar — sits
  // behind that toolbar. `dvh` is the viewport that is actually there.
  const shells = ['App.tsx', 'pages/Chat.tsx', 'pages/TemplateEditor.tsx', 'pages/PersonaEditor.tsx'];

  for (const f of shells) {
    it(`${f} uses h-dvh, not h-screen`, () => {
      const src = code(read(f));
      expect(src, `${f} still has a bare h-screen`).not.toMatch(/[`"' ]h-screen[`"' ]/);
      expect(src).toMatch(/h-dvh/);
    });
  }

  it('the staging banner override covers h-dvh as well', () => {
    // ⚠️ The trap: `index.css` shortens `.h-screen` by the staging banner's height. Renaming the
    // class without extending that rule would have pushed every shell one banner too tall on
    // staging — visible only there, which is the worst place for a layout bug to hide.
    expect(read('index.css')).toMatch(/\.staging-environment-shell \.h-dvh/);
  });
});

describe('SQEM-360 — no form control renders below 16px on a phone', () => {
  it('index.css enforces it for every field, not just the primitive', () => {
    // iOS Safari zooms the page on focus below 16px and does not zoom back. ~40 of the app's ~80
    // fields are hand-rolled with `text-sm`, so editing call sites would have been a rule to
    // remember rather than a mechanism — and the next hand-rolled field would bring the bug back.
    const css = read('index.css');
    expect(css).toMatch(/@media \(max-width: 639\.98px\)/);
    expect(css).toMatch(/font-size: 16px !important/);
  });
});

describe('SQEM-360 — every page outside Layout owns its scroll', () => {
  /**
   * The contract `ScrollScreen` states in its own comment. It listed four pages and was applied to
   * two; `LegalGate` — the screen standing in front of the entire app — was one of the two that
   * were missed, so content it could not scroll to was a button nobody could press.
   *
   * A page satisfies this either by using `ScrollScreen` or by being its own scroll container the
   * same way (`overflow-y-auto` plus a `min-h-full` wrapper). Auth does the latter, on purpose.
   */
  const pages = [
    'components/LegalGate.tsx',
    'pages/Auth.tsx',
    'pages/ResetPassword.tsx',
    'pages/InviteAccept.tsx',
  ];

  for (const f of pages) {
    it(`${f} is scrollable when its content does not fit`, () => {
      const src = code(read(f));
      const usesWrapper = /<ScrollScreen/.test(src);
      const ownsScroll = /overflow-y-auto/.test(src) && /min-h-full/.test(src);
      expect(
        usesWrapper || ownsScroll,
        `${f} has neither <ScrollScreen> nor its own overflow-y-auto + min-h-full`,
      ).toBe(true);
    });

    it(`${f} does not fall back to a bare min-h-screen`, () => {
      // That is the exact shape that breaks: `html, body { overflow: hidden }` means a
      // `min-h-screen` box grows past the viewport and is clipped, never scrolled.
      expect(code(read(f))).not.toMatch(/[`"' ]min-h-screen[`"' ]/);
    });
  }
});
