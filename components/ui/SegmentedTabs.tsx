import React from 'react';

// SQEM-069 — canonical pill tab group shared across list pages.
// Controlled via `value`/`onChange`; each tab may carry an optional icon.

export type SegmentedTab<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** SQEM-384 — native hover text; the kind tabs use it to say what a Prompt/Assistant/Skill is. */
  title?: string;
};

export default function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  fill = false,
}: {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onChange: (v: T) => void;
  // Extra classes for the outer container, e.g. `self-stretch` so the tab bar
  // matches the height of a sibling search input in a centered flex row.
  className?: string;
  /** SQEM-548 — tabs share the full width equally (the sidebar's Work | Manage switch). */
  fill?: boolean;
}) {
  return (
    <div className={`flex gap-1 bg-surface-sunken rounded-xl p-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          title={tab.title}
          // SQEM-544 — a screen reader now hears which one is on; the look said it, the markup did not.
          aria-pressed={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${fill ? 'flex-1 justify-center' : ''} ${
            value === tab.value
              ? 'bg-surface-raised text-ink-strong shadow-soft'
              : 'text-ink-muted hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
