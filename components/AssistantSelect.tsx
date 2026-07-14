import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Bot } from 'lucide-react';
import type { Prompt } from '../types';

interface Props {
  assistants: Prompt[];
  value: string | null;
  onChange: (id: string | null) => void;
  emptyLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function AssistantSelect({
  assistants,
  value,
  onChange,
  emptyLabel = 'No Assistant',
  disabled = false,
  fullWidth = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = assistants.find(a => a.id === value) ?? null;

  const triggerBase = `flex items-center gap-2 appearance-none bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none transition-all ${
    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
  } ${fullWidth ? 'w-full' : ''}`;

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={triggerBase}
      >
        {selected ? (
          <>
            <Bot className="w-4 h-4 text-slate-400 shrink-0" />
            <span className={`truncate ${fullWidth ? 'flex-1 text-left' : 'max-w-[140px]'}`}>{selected.title}</span>
          </>
        ) : (
          <span className={`text-slate-500 font-normal ${fullWidth ? 'flex-1 text-left' : ''}`}>{emptyLabel}</span>
        )}
      </button>
      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />

      {open && (
        <div className="absolute top-full mt-1 left-0 min-w-full w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 z-50 py-1 max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${!value ? 'bg-slate-50 dark:bg-slate-700 font-medium text-slate-600 dark:text-slate-300' : ''}`}
          >
            {emptyLabel}
          </button>

          {assistants.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-700" />}

          {assistants.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${value === a.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
            >
              <Bot className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{a.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
