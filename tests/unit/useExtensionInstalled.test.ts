import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useExtensionInstalled } from '../../hooks/useExtensionInstalled';

/**
 * SQEM-386 (round 3) — the setup wizard has to notice an install made in ANOTHER tab.
 *
 * The hook pinged once on mount; the Chrome Web Store opens in a new tab; coming back changed
 * nothing until a reload. Now it pings again on `focus` / `visibilitychange`. Rendered with a fake
 * `chrome.runtime` whose answer can be flipped between pings.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { installed?: boolean } | undefined;
let reply: Reply;
let pings = 0;

function installFakeChrome() {
  (window as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (_id: string, _msg: unknown, cb: (r: Reply) => void) => { pings += 1; cb(reply); },
    },
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null; host = null;
  delete (window as unknown as { chrome?: unknown }).chrome;
});

function mount() {
  function Probe() {
    const installed = useExtensionInstalled();
    return React.createElement('div', { id: 'probe', 'data-installed': String(installed) });
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(React.createElement(Probe)));
  return () => document.getElementById('probe')!.dataset.installed;
}

describe('SQEM-386 — useExtensionInstalled', () => {
  it('⛔ an install made while the tab was away is noticed when the tab comes back', () => {
    installFakeChrome();
    reply = undefined; // not installed yet
    pings = 0;
    const installed = mount();
    expect(installed()).toBe('false');
    expect(pings).toBe(1);

    reply = { installed: true }; // …the person installed it in the store tab…
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(pings).toBe(2);
    expect(installed()).toBe('true');
  });

  it('once installed, it stops pinging', () => {
    installFakeChrome();
    reply = { installed: true };
    pings = 0;
    const installed = mount();
    expect(installed()).toBe('true');
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(pings).toBe(1);
  });

  it('without chrome.runtime (Firefox, Safari) it stays false and never throws', () => {
    pings = 0;
    const installed = mount();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(installed()).toBe('false');
    expect(pings).toBe(0);
  });
});
