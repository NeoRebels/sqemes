import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// SQEM-074 — shared searchable-dropdown shell used by the context-file picker
// and the tag picker. Presentational: trigger button + search box + scrollable
// option list + an optional footer action slot. The parent owns `search` (so it
// can filter) and renders the option list / footer via render props, receiving a
// `close()` helper (single-select pickers close on choose; multi-select don't).

interface Props {
  triggerIcon: React.ReactNode;
  triggerLabel: string;
  disabled?: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  children: (close: () => void) => React.ReactNode;
  footer?: (close: () => void) => React.ReactNode;
}

export default function PickerDropdown({
  triggerIcon,
  triggerLabel,
  disabled = false,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
  footer,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onSearchChange('');
  }, [onSearchChange]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  if (disabled) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:border-brand-300 dark:hover:border-brand-500 transition-colors"
      >
        <span className="flex items-center gap-2">
          {triggerIcon}
          {triggerLabel}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-xl z-20 animate-scale-up overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 px-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {children(close)}
          </div>
          {footer && (
            <div className="border-t border-slate-100 dark:border-slate-700">
              {footer(close)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
