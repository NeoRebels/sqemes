import React from 'react';
import { ChevronDown } from 'lucide-react';

// SQEM-254 — the toolbar filter dropdown, extracted from TagFilter (SQEM-071) when a second one was
// needed rather than copied. The part worth sharing is not the markup, it is the **active styling**:
// an engaged filter has to be visible at a glance, or people forget it is on and conclude their
// files are gone. Two copies of that rule would drift, and the drift would be invisible.

export default function SelectFilter({
  icon: Icon,
  ariaLabel,
  allLabel,
  options,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  ariaLabel: string;
  allLabel: string;
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const active = !!value;
  return (
    <div className={`relative flex items-center self-stretch rounded-xl border shadow-sm transition-all ${active ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
      <Icon className={`absolute left-3 w-3.5 h-3.5 pointer-events-none ${active ? 'text-white dark:text-slate-900' : 'text-slate-400'}`} />
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        aria-label={ariaLabel}
        className={`pl-8 pr-7 h-full text-sm font-medium outline-none appearance-none bg-transparent cursor-pointer max-w-[12rem] truncate ${active ? 'text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
      >
        <option value="">{allLabel}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className={`absolute right-2 w-3.5 h-3.5 pointer-events-none ${active ? 'text-white dark:text-slate-900' : 'text-slate-400'}`} />
    </div>
  );
}
