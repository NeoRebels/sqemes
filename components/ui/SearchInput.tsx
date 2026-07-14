import React from 'react';
import { Search } from 'lucide-react';

// SQEM-069 — canonical search input shared across list pages (Templates, Files, …).
// Styling matches the Templates page; pass `containerClassName` to control the
// wrapper sizing (defaults to a flexible search bar that fills available width).

export default function SearchInput({
  value,
  onChange,
  placeholder,
  containerClassName = 'flex-1 min-w-[200px]',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  containerClassName?: string;
}) {
  return (
    <div className={`relative ${containerClassName}`}>
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-12 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none shadow-sm transition-all"
      />
    </div>
  );
}
