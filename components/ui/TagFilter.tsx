import React from 'react';
import { Tag, ChevronDown } from 'lucide-react';

// SQEM-071 — shared tag-filter dropdown used by Templates and Files.
// Presentational + controlled; `tags` is the workspace tag vocabulary
// (see lib/workspaceTags.ts). Selecting the "all" option passes null.

export default function TagFilter({
  tags,
  value,
  onChange,
  allLabel = 'All Tags',
}: {
  tags: string[];
  value: string | null;
  onChange: (tag: string | null) => void;
  allLabel?: string;
}) {
  return (
    <div className={`relative flex items-center self-stretch rounded-xl border shadow-sm transition-all ${value ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
      <Tag className={`absolute left-3 w-3.5 h-3.5 pointer-events-none ${value ? 'text-white dark:text-slate-900' : 'text-slate-400'}`} />
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        aria-label="Filter by tag"
        className={`pl-8 pr-7 h-full text-sm font-medium outline-none appearance-none bg-transparent cursor-pointer ${value ? 'text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'}`}
      >
        <option value="">{allLabel}</option>
        {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
      </select>
      <ChevronDown className={`absolute right-2 w-3.5 h-3.5 pointer-events-none ${value ? 'text-white dark:text-slate-900' : 'text-slate-400'}`} />
    </div>
  );
}
