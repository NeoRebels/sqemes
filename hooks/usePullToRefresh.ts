import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  PULL_THRESHOLD_PX, isStandaloneDisplay, phaseFor, pullDistance, type PullPhase,
} from '../lib/pullToRefresh';

export interface PullToRefreshState {
  /** Indicator travel in px, 0 when nothing is happening. */
  distance: number;
  phase: PullPhase;
  /** False in a browser tab — then nothing is wired and the indicator renders nothing. */
  enabled: boolean;
}

/**
 * SQEM-385 — pull down at the top of a scroll container to reload the installed app.
 *
 * Attach to the element that actually scrolls (the shell's `<main>`, `ScrollScreen`, the chat's
 * message list). A pull counts only when it STARTS at `scrollTop === 0` and moves DOWN; a swipe up,
 * or a finger that lands mid-list, is ordinary scrolling and never reaches the indicator.
 *
 * ⚠️ `touchmove` is registered non-passive and cancelled while pulling — that is what stops iOS
 * from rubber-banding the container underneath the indicator. It is cancelled only while a pull is
 * actually in progress, so scrolling performance elsewhere is untouched.
 *
 * `onRefresh` defaults to `location.reload()` (see `lib/pullToRefresh.ts` for why that is a hard
 * reload here); the tests pass a spy. `enabled` defaults to the standalone check and exists as a
 * parameter for the same reason.
 */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  opts: { enabled?: boolean; onRefresh?: () => void } = {},
): PullToRefreshState {
  const enabled = opts.enabled ?? isStandaloneDisplay();
  // The latest `onRefresh` lives in a ref so the listener effect below never has to re-subscribe;
  // it is written in an effect, not during render, which is the form the React Compiler lint accepts.
  const onRefreshRef = useRef(opts.onRefresh);
  useEffect(() => { onRefreshRef.current = opts.onRefresh; });

  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<PullPhase>('idle');
  const phaseRef = useRef<PullPhase>('idle');

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startY: number | null = null;
    let dist = 0;
    const set = (d: number, p: PullPhase) => {
      dist = d;
      phaseRef.current = p;
      setDistance(d);
      setPhase(p);
    };

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing') return;
      // ⛔ Only a touch that lands with the list at its top can become a pull. Anywhere else it is
      // a scroll, and the browser owns it.
      if (el.scrollTop > 0) { startY = null; return; }
      startY = e.touches[0]?.clientY ?? null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      const d = pullDistance(y - startY);
      if (d === 0 || el.scrollTop > 0) {
        if (dist > 0) set(0, 'idle');
        return;
      }
      set(d, phaseFor(d));
      if (e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (dist >= PULL_THRESHOLD_PX) {
        set(PULL_THRESHOLD_PX, 'refreshing');
        (onRefreshRef.current ?? (() => window.location.reload()))();
      } else if (dist > 0) {
        set(0, 'idle');
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref, enabled]);

  return { distance, phase, enabled };
}
