import React from 'react';

/**
 * SQEM-620 — an on/off filter chip in a list's toolbar ("Not in a persona"), the same shape as
 * the Favorites toggle beside it. The Favorites toggle keeps its own amber look (a star means a star);
 * every other filter uses the accent, so two active filters never look like two favourites.
 */
export default function FilterToggle({ active, onClick, icon, label, title, disabled }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1.5 self-stretch px-3.5 py-2 rounded-xl text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${active ? 'bg-accent-soft text-accent border-accent/30 shadow-sm' : 'bg-surface-raised border-line text-ink-muted hover:bg-surface-sunken'}`}
    >
      {icon}
      {label}
    </button>
  );
}
