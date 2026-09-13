import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal from '../../components/ui/Modal';

/**
 * SQEM-382 — a drag-select that ends over the overlay must not close the modal.
 *
 * ⛔ A `click` fires on the nearest common ancestor of mouse-down and mouse-up. Select text inside
 * the panel, release outside, and the browser reports a click on the overlay. With a bare
 * `onClick={onClose}` that dismissed the Setup Wizard mid-sentence in a UX test (2026-09-08).
 *
 * ⭐ This renders the real primitive in jsdom instead of asserting on its source text. The two
 * source-assertion tests that both went green around SQEM-374 are why: a behaviour is what has to
 * hold, and only a rendered component can show it. React 19 exports `act`; no testing library.
 *
 * ⚠️ `vitest` only picks up `*.test.ts`, so this file has no JSX — `React.createElement` throughout.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mouse = (type: string, target: Element) =>
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); });

describe('SQEM-382 — Modal closes on a press that began outside, not on a click that merely lands outside', () => {
  let root: Root;
  let host: HTMLDivElement;
  // ⚠️ Typed: a bare `vi.fn()` is `Mock<Procedure | Constructable>`, which `tsc` (CI) rejects for
  // `onClose?: () => void` while vitest (esbuild) does not care — the SQEM-381 trap, again.
  let onClose: Mock<() => void>;
  let inner: HTMLElement;
  let overlay: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onClose = vi.fn<() => void>();
    act(() => {
      // `children` inside the props object, and the lint rule against it switched off for this one
      // line: `ModalProps` declares `children` REQUIRED, so `tsc` (CI) rejects the
      // `createElement(type, props, ...children)` overload, while eslint's `react/no-children-prop`
      // rejects the form `tsc` accepts. Two checkers, one call, opposite demands — the disable is
      // the smaller concession, and widening `ModalProps` for a test would be the wrong one.
      root.render(
        // eslint-disable-next-line react/no-children-prop
        React.createElement(Modal, {
          open: true,
          onClose,
          children: React.createElement('p', { id: 'inner' }, 'select me'),
        }),
      );
    });
    inner = document.getElementById('inner')!;
    // The primitive portals to <body>: inner → panel → centring wrapper → overlay → body.
    overlay = inner.parentElement!.parentElement!.parentElement!;
    expect(overlay.parentElement).toBe(document.body);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('⛔ press inside the panel, release outside → the modal stays open', () => {
    mouse('mousedown', inner);
    mouse('mouseup', overlay);
    mouse('click', overlay); // what the browser synthesises for that gesture
    expect(onClose).not.toHaveBeenCalled();
  });

  it('press AND release outside → closes, exactly as before', () => {
    mouse('mousedown', overlay);
    mouse('mouseup', overlay);
    mouse('click', overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click with no mouse-down at all (keyboard / programmatic) still closes — the old contract', () => {
    mouse('click', overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the refusal is per gesture: a later outside press still closes', () => {
    mouse('mousedown', inner);
    mouse('click', overlay);
    expect(onClose).not.toHaveBeenCalled();
    mouse('mousedown', overlay);
    mouse('click', overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('⛔ a `mousedown` inside the panel still reaches `document` — the click-outside dropdowns depend on it', () => {
    // Eight components (`PickerDropdown`, `ModelSelect`, `PersonaSelect`, `Sidebar`, `Files`,
    // three in `Chat`) close from a `mousedown` listener on `document`. A `stopPropagation` on the
    // panel would have been the obvious fix for the bug above — and would have broken all of them
    // inside every modal. This is the assertion that keeps that "simplification" out.
    const reached = vi.fn();
    document.addEventListener('mousedown', reached);
    try {
      mouse('mousedown', inner);
      expect(reached).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('mousedown', reached);
    }
  });

  it('a click inside the panel never closes (unchanged)', () => {
    mouse('mousedown', inner);
    mouse('click', inner);
    expect(onClose).not.toHaveBeenCalled();
  });
});
