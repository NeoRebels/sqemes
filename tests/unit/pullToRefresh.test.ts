import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PULL_THRESHOLD_PX, PULL_MAX_PX, pullDistance, phaseFor, isStandaloneDisplay,
} from '../../lib/pullToRefresh';
import { usePullToRefresh, type PullToRefreshState } from '../../hooks/usePullToRefresh';
import PullToRefreshIndicator from '../../components/PullToRefreshIndicator';

/**
 * SQEM-385 — pull-to-refresh for the installed app.
 *
 * ⚠️ jsdom has no gestures and no layout. What CAN be pinned here: the numbers, the standalone
 * check, and the hook's state machine driven by synthetic touch events with a stubbed `touches`
 * list. What cannot: whether it feels right on a phone — that is the owner's iPhone, in the DoD.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ROOT = resolve(__dirname, '../../');

describe('SQEM-385 — the numbers (lib/pullToRefresh.ts)', () => {
  it('upward or zero finger travel is no pull at all', () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
  });
  it('downward travel is damped and capped', () => {
    expect(pullDistance(100)).toBe(50);
    expect(pullDistance(10_000)).toBe(PULL_MAX_PX);
    expect(PULL_MAX_PX).toBeGreaterThan(PULL_THRESHOLD_PX);
  });
  it('phases follow the threshold', () => {
    expect(phaseFor(0)).toBe('idle');
    expect(phaseFor(PULL_THRESHOLD_PX - 1)).toBe('pulling');
    expect(phaseFor(PULL_THRESHOLD_PX)).toBe('ready');
  });
  it('⛔ standalone: iOS flag, or the display-mode query — never a plain tab', () => {
    const mm = (matches: boolean) => ((q: string) => ({ matches: q.includes('standalone') && matches })) as unknown as Window['matchMedia'];
    expect(isStandaloneDisplay({ navigator: { standalone: true } as never })).toBe(true);
    expect(isStandaloneDisplay({ navigator: {} as never, matchMedia: mm(true) })).toBe(true);
    expect(isStandaloneDisplay({ navigator: {} as never, matchMedia: mm(false) })).toBe(false);
    expect(isStandaloneDisplay(undefined)).toBe(false);
  });
});

// ---------- the hook, rendered ----------

const touch = (el: Element, type: string, clientY: number) => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: [{ clientY }] });
  act(() => { el.dispatchEvent(ev); });
  return ev;
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The hook's state, read back from data attributes — rendering it is the one honest way out of a
 *  component; writing it into an outer variable during render is exactly what the compiler lint
 *  forbids, and for good reason. */
const stateOf = (el: HTMLElement): PullToRefreshState => ({
  distance: Number(el.dataset.distance),
  phase: el.dataset.phase as PullToRefreshState['phase'],
  enabled: el.dataset.enabled === 'true',
});

function mountProbe(opts: { enabled: boolean; onRefresh: Mock<() => void> }) {
  function Probe() {
    const ref = React.useRef<HTMLDivElement>(null);
    const state = usePullToRefresh(ref, opts);
    // The compiler lint cannot tell that `ref` in this object is createElement's ref PROP (in JSX
    // it would be `<div ref={ref}>`); vitest only picks up .test.ts, so JSX is not available here.
    // eslint-disable-next-line react-hooks/refs
    return React.createElement('div', {
      ref, id: 'scroller',
      'data-distance': state.distance, 'data-phase': state.phase, 'data-enabled': String(state.enabled),
    });
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(React.createElement(Probe)));
  const el = document.getElementById('scroller')!;
  return { el };
}

describe('SQEM-385 — the gesture (hooks/usePullToRefresh.ts)', () => {
  it('⛔ a pull past the threshold, released, refreshes exactly once', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    touch(el, 'touchstart', 100);
    touch(el, 'touchmove', 200); // finger +100 → indicator 50 → pulling
    expect(stateOf(el)).toMatchObject({ distance: 50, phase: 'pulling' });
    touch(el, 'touchmove', 260); // finger +160 → indicator 80 ≥ 72 → ready
    expect(stateOf(el)).toMatchObject({ distance: 80, phase: 'ready' });
    touch(el, 'touchend', 260);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(stateOf(el)).toMatchObject({ distance: PULL_THRESHOLD_PX, phase: 'refreshing' });
  });

  it('⛔ released below the threshold: nothing happens, state returns to idle', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    touch(el, 'touchstart', 100);
    touch(el, 'touchmove', 150); // indicator 25
    expect(stateOf(el).phase).toBe('pulling');
    touch(el, 'touchend', 150);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(stateOf(el)).toMatchObject({ distance: 0, phase: 'idle' });
  });

  it('⛔ a swipe UP is scrolling, not a pull', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    touch(el, 'touchstart', 300);
    touch(el, 'touchmove', 100);
    touch(el, 'touchend', 100);
    expect(stateOf(el)).toMatchObject({ distance: 0, phase: 'idle' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('⛔ a touch that lands with the list scrolled down never becomes a pull', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    Object.defineProperty(el, 'scrollTop', { value: 40, configurable: true });
    touch(el, 'touchstart', 100);
    touch(el, 'touchmove', 400);
    touch(el, 'touchend', 400);
    expect(stateOf(el)).toMatchObject({ distance: 0, phase: 'idle' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('⛔ the START decides: a touch that landed scrolled down stays a scroll even if the list reaches the top under it', () => {
    // Two guards exist — one at touchstart, one per touchmove — and the previous case cannot tell
    // them apart (the move guard alone passes it). This one can: the list is scrolled at touchstart
    // and at the top by the first move, which is what a long swipe-to-top followed by more pulling
    // looks like. Native iOS makes the same call: pull-to-refresh begins at the top or not at all.
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    Object.defineProperty(el, 'scrollTop', { value: 40, configurable: true });
    touch(el, 'touchstart', 100);
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true });
    touch(el, 'touchmove', 400);
    touch(el, 'touchend', 400);
    expect(stateOf(el)).toMatchObject({ distance: 0, phase: 'idle' });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('touchmove is cancelled only while pulling — ordinary scrolling keeps its default', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: true, onRefresh });
    touch(el, 'touchstart', 100);
    const pulling = touch(el, 'touchmove', 200);
    expect(pulling.defaultPrevented).toBe(true);
    touch(el, 'touchend', 200);
    touch(el, 'touchstart', 300);
    const scrolling = touch(el, 'touchmove', 100);
    expect(scrolling.defaultPrevented).toBe(false);
  });

  it('⛔ disabled (a browser tab): the hook wires nothing', () => {
    const onRefresh = vi.fn<() => void>();
    const { el } = mountProbe({ enabled: false, onRefresh });
    touch(el, 'touchstart', 100);
    touch(el, 'touchmove', 400);
    touch(el, 'touchend', 400);
    expect(stateOf(el)).toMatchObject({ distance: 0, phase: 'idle', enabled: false });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('SQEM-385 — the indicator', () => {
  function render(state: PullToRefreshState) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(PullToRefreshIndicator, state)));
    return host;
  }
  it('renders nothing when disabled', () => {
    expect(render({ distance: 0, phase: 'idle', enabled: false }).innerHTML).toBe('');
  });
  it('says what releasing will do', () => {
    expect(render({ distance: 30, phase: 'pulling', enabled: true }).textContent).toContain('Pull to refresh');
  });
  it('changes its word at the threshold, and again while refreshing', () => {
    expect(render({ distance: 80, phase: 'ready', enabled: true }).textContent).toContain('Release to refresh');
    act(() => root!.unmount()); host?.remove();
    expect(render({ distance: 72, phase: 'refreshing', enabled: true }).textContent).toContain('Refreshing');
  });
});

describe('SQEM-385 — every scroll container that should reload carries all three lines', () => {
  const cases: [string, string][] = [
    ['App.tsx', '<main ref={mainRef}'],
    ['components/ScrollScreen.tsx', '<div ref={ref}'],
    ['pages/Chat.tsx', '<div ref={messagesScrollRef}'],
  ];
  for (const [file, tag] of cases) {
    it(`${file}: hook, indicator and overscroll-y-contain`, () => {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      expect(src, 'hook').toMatch(/usePullToRefresh\(/);
      expect(src, 'indicator').toMatch(/<PullToRefreshIndicator \{\.\.\.pull\} \/>/);
      const open = src.indexOf(tag);
      expect(open, `${tag} present`).toBeGreaterThan(-1);
      const openTag = src.slice(open, src.indexOf('>', open));
      expect(openTag, 'overscroll-y-contain on that container').toContain('overscroll-y-contain');
    });
  }
});
