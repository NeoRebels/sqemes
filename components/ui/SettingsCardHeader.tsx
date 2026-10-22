import React from 'react';

/**
 * SQEM-554 (d) — the head of a Settings card, once. Before, every card wrote its own `<h2 text-lg
 * font-bold slate-900>` plus a slate subtitle and placed its Save button by hand; seven of them.
 *
 * The title is in the display face (C uses it from 20 px), the icon in the accent, the description
 * muted. `actions` sits to the right from `sm` and below the text on a phone, so a Save button never
 * squeezes the heading. `tone="danger"` is for the one card that deletes things.
 */
export default function SettingsCardHeader({
  title,
  description,
  icon,
  actions,
  tone = 'default',
  className = 'mb-6',
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
}) {
  const danger = tone === 'danger';
  return (
    <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2 className={`font-display text-xl font-semibold flex items-center gap-2 ${danger ? 'text-danger' : 'text-ink-strong'}`}>
          {icon && <span aria-hidden className={`shrink-0 [&>svg]:w-5 [&>svg]:h-5 ${danger ? 'text-danger' : 'text-accent'}`}>{icon}</span>}
          {title}
        </h2>
        {description && <div className={`text-sm mt-1 ${danger ? 'text-danger' : 'text-ink-muted'}`}>{description}</div>}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The label above a Settings field, once (it was written out nine times). */
export const SETTINGS_FIELD_LABEL = 'block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2';
