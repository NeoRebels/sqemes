import React from 'react';

/**
 * SQEM-099 — Scroll-safe full-screen wrapper for pages rendered outside `Layout`.
 *
 * The app shell sets `html, body { height:100%; overflow:hidden }` and scrolls in inner
 * containers. A page that uses `min-h-screen` on its own (Auth, ResetPassword, InviteAccept,
 * the gate) gets clipped with no scroll when its content exceeds the viewport (zoom / short
 * screens). This component is its own scroll container: content stays vertically centred when
 * it fits and becomes scrollable when it doesn't.
 */
const ScrollScreen = ({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) => (
  <div className={`h-screen overflow-y-auto ${className}`}>
    {/* Extra bottom padding so tall content clears iOS Safari's bottom toolbar
        (h-screen = the large 100vh viewport; its bottom sits behind the toolbar). */}
    <div className="min-h-full flex items-center justify-center px-4 pt-4 pb-24">
      {children}
    </div>
  </div>
);

export default ScrollScreen;
