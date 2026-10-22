import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Modal from '../../components/ui/Modal';
import FullScreenExit from '../../components/ui/FullScreenExit';

/**
 * SQEM-535 — the Modal primitive is a dialog: a role and a name, Escape closes the TOP one only,
 * focus moves in, stays in, and returns.
 *
 * Rendered in jsdom like `modalDragSelect.test.ts` — no JSX in a `.test.ts`, no testing library.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

const key = (k: string, target: Element = document.activeElement ?? document.body, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(e); });
  return e;
};

// `children` must go in the props object: `ModalProps` declares it required (see modalDragSelect).
const modal = (props: { open?: boolean; onClose?: () => void; id: string; children?: React.ReactNode }) =>
  // eslint-disable-next-line react/no-children-prop
  h(Modal, {
    open: props.open ?? true,
    onClose: props.onClose,
    children: props.children ?? h('div', null,
      h('h3', null, `Title ${props.id}`),
      h('button', { id: `${props.id}-first` }, 'first'),
      h('button', { id: `${props.id}-last` }, 'last'),
    ),
  });

describe('SQEM-535 — Modal is a dialog', () => {
  let root: Root;
  let host: HTMLDivElement;
  let opener: HTMLButtonElement;
  let onClose: Mock<() => void>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();
    root = createRoot(host);
    onClose = vi.fn<() => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    opener.remove();
  });

  it('has role="dialog", aria-modal and its first heading as the name', () => {
    act(() => root.render(modal({ id: 'a', onClose })));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelled = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(labelled?.textContent).toBe('Title a');
  });

  it('moves focus into the dialog, traps Tab, and returns focus on close', () => {
    act(() => root.render(modal({ id: 'a', onClose })));
    const first = document.getElementById('a-first')!;
    const last = document.getElementById('a-last')!;
    expect(document.activeElement).toBe(first);

    last.focus();
    key('Tab', last);
    expect(document.activeElement).toBe(first);
    key('Tab', first, { shiftKey: true });
    expect(document.activeElement).toBe(last);

    act(() => root.render(modal({ id: 'a', open: false, onClose })));
    expect(document.activeElement).toBe(opener);
  });

  it('Escape closes it', () => {
    act(() => root.render(modal({ id: 'a', onClose })));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('⛔ with two open, Escape closes only the top one', () => {
    const outerClose = vi.fn<() => void>();
    const innerClose = vi.fn<() => void>();
    act(() => root.render(h('div', null, modal({ id: 'outer', onClose: outerClose }), modal({ id: 'inner', onClose: innerClose }))));
    key('Escape');
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('without onClose (busy), Escape does nothing — and is still swallowed', () => {
    act(() => root.render(modal({ id: 'a' })));
    const e = key('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('an Escape claimed inside the dialog (preventDefault) does not close it', () => {
    const claim = h('div', { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault(); } },
      h('h3', null, 'T'), h('button', { id: 'inside' }, 'x'));
    act(() => root.render(modal({ id: 'a', onClose, children: claim })));
    key('Escape', document.getElementById('inside')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('⛔ FullScreenExit does not leave the page on the Escape that closed a dialog', () => {
    const onExit = vi.fn<() => void>();
    act(() => root.render(h('div', null,
      h(FullScreenExit, { label: 'Back', onExit, escapeEnabled: true }),
      modal({ id: 'a', onClose }),
    )));
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});
