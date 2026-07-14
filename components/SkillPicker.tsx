import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Search, Wand2 } from 'lucide-react';
import type { Prompt } from '../types';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  skills: Prompt[];
  disabled?: boolean;
}

export function SkillPicker({ selectedIds, onChange, skills, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = skills.filter(s => selectedIds.includes(s.id));
  const available = skills.filter(s =>
    !selectedIds.includes(s.id) &&
    s.title.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 px-2 py-1 rounded-lg text-xs font-medium">
              <Wand2 className="w-3 h-3 shrink-0" />
              {s.title}
              {!disabled && (
                <button type="button" onClick={() => toggle(s.id)} className="hover:text-emerald-900 dark:hover:text-emerald-200 ml-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Trigger */}
      {!disabled && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded-xl text-sm text-slate-500 dark:text-slate-400 hover:border-brand-300 dark:hover:border-brand-500 transition-colors"
        >
          <span>{skills.length === 0 ? 'No skills created yet' : 'Add a skill...'}</span>
          <ChevronDown className="w-4 h-4 shrink-0" />
        </button>
      )}

      {open && skills.length > 0 && (
        <div className="absolute top-full left-0 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-xl z-20 animate-scale-up overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2 px-2">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search skills..."
                className="flex-1 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {available.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-400 text-center">
                {search ? 'No skills match your search' : 'All skills already selected'}
              </div>
            ) : (
              available.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { toggle(s.id); setSearch(''); }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{s.title}</p>
                    {s.description && <p className="text-xs text-slate-400 truncate">{s.description}</p>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
