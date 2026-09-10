import React from 'react';

/**
 * SQEM-099 — Scroll-safe full-screen wrapper for pages rendered outside `Layout`.
 *
 * The app shell sets `html, body { height:100%; overflow:hidden }` and scrolls in inner
 * containers. A page that uses `min-h-screen` on its own (Auth, ResetPassword, InviteAccept,
 * the gate) gets clipped with no scroll when its content exceeds the viewport (zoom / short
 * screens). This component is its own scroll container: content stays vertically centred when
 * it fits and becomes scrollable when it doesn't.
 *
 * ⛔ SQEM-360 — **the list above names four pages and this was applied to two.** `LegalGate` had no
 * scroll container at all until 2026-09-10, and it is the one screen that stands in front of the
 * whole app: content it cannot scroll to is a button nobody can press. Written down because the
 * fix existed, was documented here by name, and still was not everywhere — nothing checked.
 */
const ScrollScreen = ({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) => (
  <div className={`h-dvh overflow-y-auto ${className}`}>
    {/* SQEM-360 — `h-dvh` tracks the viewport that is actually visible, so the bottom no longer
        sits behind iOS Safari's toolbar the way `h-screen` (= the large 100vh) did. The bottom
        padding stays: `dvh` follows the toolbar as it collapses and expands, and during that
        animation the last element would otherwise sit right on the edge. */}
    <div className="min-h-full flex items-center justify-center px-4 pt-4 pb-24">
      {children}
    </div>
  </div>
);

export default ScrollScreen;
