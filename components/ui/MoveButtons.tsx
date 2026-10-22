import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

/**
 * SQEM-540 — "Move up" / "Move down" beside a drag handle, so a list that can be reordered by dragging
 * can also be reordered by keyboard and on a phone (HTML5 drag-and-drop does not work on touch).
 * Each button is 24 × 24 px (WCAG 2.5.8) and names the item it moves.
 */
export default function MoveButtons({
  label,
  index,
  count,
  onMove,
}: {
  /** What is being moved, for the accessible names ("Move Sales up"). */
  label: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const cls = 'p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors';
  return (
    <span className="inline-flex items-center">
      <button type="button" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={e => { e.stopPropagation(); onMove(index - 1); }} className={cls}>
        <ChevronUp className="w-3 h-3" />
      </button>
      <button type="button" aria-label={`Move ${label} down`} title="Move down" disabled={index === count - 1} onClick={e => { e.stopPropagation(); onMove(index + 1); }} className={cls}>
        <ChevronDown className="w-3 h-3" />
      </button>
    </span>
  );
}
