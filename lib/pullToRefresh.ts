/**
 * SQEM-385 — pull-to-refresh for the installed app: the pure half.
 *
 * ⛔ Why this exists at all: `display: standalone` (SQEM-361) removes the browser chrome, and with it
 * the reload button. iOS offers no native pull-to-refresh in that mode, so a stuck screen or a new
 * deploy leaves the user one option — kill the app. There is deliberately no service worker, so a
 * plain `location.reload()` fetches fresh HTML and therefore the current bundle: that IS the "hard"
 * reload, nothing cached stands in the way.
 *
 * Numbers and phases live here, React-free, so the test can pin them without rendering anything.
 */

/** How far the pill has to travel before releasing triggers a reload. */
export const PULL_THRESHOLD_PX = 72;
/** The pill never travels further than this, however far the finger goes. */
export const PULL_MAX_PX = 120;
/** Finger distance → pill distance. Half feels like resistance; 1:1 feels like the page tearing off. */
export const PULL_DAMPING = 0.5;

export type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing';

/** Finger travel (positive = downwards) → indicator distance. Upward travel is 0, never negative. */
export function pullDistance(fingerDy: number): number {
  if (fingerDy <= 0) return 0;
  return Math.min(PULL_MAX_PX, Math.round(fingerDy * PULL_DAMPING));
}

export function phaseFor(distance: number): Exclude<PullPhase, 'refreshing'> {
  if (distance <= 0) return 'idle';
  return distance >= PULL_THRESHOLD_PX ? 'ready' : 'pulling';
}

/**
 * True when the page runs as an installed app. iOS Safari sets `navigator.standalone`; everything
 * else answers the `display-mode` media query. ⚠️ Only here is the gesture wired up — in a browser
 * tab there is a reload button, and on Android the browser's own pull-to-refresh would double up.
 */
export function isStandaloneDisplay(
  win: { matchMedia?: Window['matchMedia']; navigator?: Navigator & { standalone?: boolean } } | undefined =
    typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!win) return false;
  if (win.navigator?.standalone === true) return true;
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}
