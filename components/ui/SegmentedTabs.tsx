import React from 'react';

// SQEM-069 — canonical pill tab group shared across list pages.
// Controlled via `value`/`onChange`; each tab may carry an optional icon.

export type SegmentedTab<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

export default function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: readonly SegmentedTab<T>[];
  value: T;
  onChange: (v: T) => void;
  // Extra classes for the outer container, e.g. `self-stretch` so the tab bar
  // matches the height of a sibling search input in a centered flex row.
  className?: string;
}) {
  return (
    <div className={`flex gap-1 bg-slate-100 dark:bg-slate-700 rounded-xl p-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
            value === tab.value
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-soft'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
