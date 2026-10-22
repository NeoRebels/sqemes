import React from 'react';

/**
 * SQEM-545 — the on/off switch, once.
 *
 * Three were hand-built before this (Content Governance in Settings, the dark-mode toggle in the
 * Sidebar, one in the setup wizard), each with its own sizes and colours. This is the one the design
 * system shows on `/design`; moving those three onto it is part of G, not of this ticket.
 *
 * It is a `button role="switch"`, so it needs a name: pass `label` (visible text it is named by) via
 * `labelledBy`, or `ariaLabel` when there is no visible text. One of the two is required by the type.
 */
type Naming = { labelledBy: string; ariaLabel?: never } | { ariaLabel: string; labelledBy?: never };

export default function Switch({
  checked,
  onChange,
  disabled = false,
  describedBy,
  ...naming
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
} & Naming) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={naming.labelledBy}
      aria-label={naming.ariaLabel}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-accent-strong' : 'bg-slate-200 dark:bg-slate-600'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}
