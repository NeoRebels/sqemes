import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
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
  /**
   * SQEM-550 — the panel is as wide as the trigger by default (the pickers in forms are full-width).
   * A compact trigger (the persona chip on Start) needs `wide`: at least 18rem, never wider than the
   * screen, so the names in it can be read.
   */
  wide?: boolean;
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
  wide = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
    <div
      ref={containerRef}
      className="relative"
      // SQEM-544 — Escape closes the list and returns focus to the trigger. It is claimed
      // (`preventDefault`) so a surrounding Modal does not close too (see SQEM-535).
      onKeyDown={e => {
        if (e.key === 'Escape' && open) { e.preventDefault(); close(); triggerRef.current?.focus(); }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        // A disclosure, not a listbox: the panel holds a search field and plain buttons.
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 border border-line-strong bg-surface-field rounded-xl text-sm text-ink-muted hover:border-brand-300 dark:hover:border-brand-500 transition-colors"
      >
        <span className="flex items-center gap-2">
          {triggerIcon}
          {triggerLabel}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>

      {open && (
        <div id={panelId} className={`absolute top-full left-0 ${wide ? 'min-w-full w-72 max-w-[85vw]' : 'w-full'} mt-1 bg-surface-raised border border-line rounded-xl shadow-xl z-20 animate-scale-up overflow-hidden`}>
          <div className="p-2 border-b border-line">
            <div className="flex items-center gap-2 px-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                autoFocus
                aria-label={searchPlaceholder}
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 text-sm bg-transparent outline-none text-ink placeholder-slate-400"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {children(close)}
          </div>
          {footer && (
            <div className="border-t border-line">
              {footer(close)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
