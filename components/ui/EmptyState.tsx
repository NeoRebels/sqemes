import React from 'react';

// SQEM-069 — canonical empty / no-results state shared across list pages.
// Dashed rounded card with an icon tile, heading, subtext and optional action.
//
// SQEM-554 (a) — the tile is the component's, not the caller's: `tone` picks it. `brand` for "create
// your first …" (accent tile, accent icon), `neutral` (default) for "nothing matches your filter".
// Before, every caller brought its own `bg-brand-50 …` or `slate` class and no two empty states
// looked quite alike. The icon inherits the tone's colour; a caller may still colour it on purpose
// (the favourites star stays amber). The title is in the display face, which C allows from 20 px.

const TONES = {
  brand: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-sunken text-ink-subtle',
} as const;

export default function EmptyState({
  icon,
  tone = 'neutral',
  title,
  description,
  extra,
  action,
}: {
  icon: React.ReactNode;
  tone?: keyof typeof TONES;
  title: string;
  description: string;
  /** SQEM-287 — optional block between the subtext and the action. Added for the Templates page,
   *  where "no templates yet" is the first screen a new user sees and the three kinds need a line
   *  each. Optional so every other empty state stays exactly as it was. */
  extra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    // SQEM-388 — `px-6`: the `extra` block (Templates: the three kinds; Personas: the "Sales" example)
    // used to touch the card edge on a phone — there was no horizontal padding at all.
    <div className="text-center py-20 px-6 bg-surface-raised rounded-card border border-line border-dashed">
      <div className={`w-16 h-16 ${TONES[tone]} rounded-full flex items-center justify-center mx-auto mb-4`}>
        {icon}
      </div>
      <h3 className="font-display text-xl font-semibold text-ink-strong">{title}</h3>
      <p className={`text-ink-subtle text-sm mt-1 ${action && !extra ? 'mb-5' : ''}`}>{description}</p>
      {extra}
      {action && <div className={extra ? 'mt-5' : ''}>{action}</div>}
    </div>
  );
}
