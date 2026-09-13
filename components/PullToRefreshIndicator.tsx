import React from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import type { PullToRefreshState } from '../hooks/usePullToRefresh';

/**
 * SQEM-385 — the pill that follows the finger. Render it as the FIRST child of the scroll container
 * the hook is attached to: `sticky top-0` keeps it at the container's top edge, `h-0` means it takes
 * no space, and at distance 0 the pill sits above the edge where the container clips it. Nothing in
 * the layout moves until somebody pulls.
 */
export default function PullToRefreshIndicator({ distance, phase, enabled }: PullToRefreshState) {
  if (!enabled) return null;
  const label = phase === 'refreshing' ? 'Refreshing…' : phase === 'ready' ? 'Release to refresh' : 'Pull to refresh';
  return (
    <div aria-live="polite" className="sticky top-0 z-30 h-0 overflow-visible pointer-events-none flex justify-center">
      <div
        style={{
          transform: `translateY(${distance - 44}px)`,
          opacity: Math.min(1, distance / 24),
          transition: phase === 'pulling' ? 'none' : 'transform 150ms ease-out, opacity 150ms ease-out',
        }}
        className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-soft text-xs font-semibold text-slate-600 dark:text-slate-300"
      >
        {phase === 'refreshing'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <ArrowDown className={`w-3.5 h-3.5 transition-transform ${phase === 'ready' ? 'rotate-180' : ''}`} />}
        {label}
      </div>
    </div>
  );
}
