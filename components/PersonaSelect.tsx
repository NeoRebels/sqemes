import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Bot, Plus } from 'lucide-react';
import type { Persona } from '../types';

/**
 * SQEM-390 (PR C) — the persona picker in the Chat top bar: the role of this session, chosen where
 * the model is chosen.
 *
 * ⚠️ Until now a role could be set in Chat only from a persona card (SQEM-389). With the assistant
 * kind gone, the launch modal offers no role at all — a person already in a conversation had no way
 * to adopt one without leaving it. This is the `AssistantSelect` that was removed with the kind, on
 * the object that replaced it, in the same optics as `ModelSelect` beside it.
 *
 * ⚠️ Closes from a `mousedown` listener on `document`, like the seven dropdowns before it — the
 * pattern `components/ui/Modal.tsx` relies on (a stopped `mousedown` would break every one of
 * them inside a modal; see the note there).
 *
 * The list is whatever `fetchPersonas` returns — RLS (`persona_access`) has already decided what
 * this person may see. An empty list with `onEmptyAction` shows a CTA instead of an empty menu,
 * the way `ModelSelect` does for "Add API key".
 */
interface Props {
  personas: Persona[];
  /** The applied persona's id, or null for none. */
  value: string | null;
  onChange: (persona: Persona | null) => void;
  /** Called when the trigger opens, so the caller can refresh the list. */
  onOpen?: () => void;
  emptyLabel?: string;
  /** With no personas at all: a CTA instead of an empty dropdown (e.g. "Create a persona"). */
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  disabled?: boolean;
}

export function PersonaSelect({
  personas,
  value,
  onChange,
  onOpen,
  emptyLabel = 'No persona',
  emptyActionLabel,
  onEmptyAction,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = personas.find(p => p.id === value) ?? null;
  const showEmptyAction = personas.length === 0 && !!onEmptyAction && !selected;

  const triggerBase = `flex items-center gap-2 appearance-none bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none transition-all ${
    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
  }`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          if (showEmptyAction) { onEmptyAction!(); return; }
          setOpen(o => {
            if (!o) onOpen?.();
            return !o;
          });
        }}
        className={triggerBase}
        title={selected ? `Persona: ${selected.title}` : 'Choose a persona — the role for this chat'}
      >
        <Bot className={`w-4 h-4 shrink-0 ${selected ? 'text-brand-500' : 'text-slate-400'}`} />
        {selected ? (
          <span className="truncate max-w-[140px]">{selected.title}</span>
        ) : showEmptyAction ? (
          <span className="flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-semibold"><Plus className="w-3.5 h-3.5" />{emptyActionLabel}</span>
        ) : (
          <span className="text-slate-500 font-normal">{emptyLabel}</span>
        )}
      </button>
      {!showEmptyAction && (
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}

      {open && (
        <div className="absolute top-full mt-1 left-0 min-w-full w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700 z-50 py-1 max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${!value ? 'bg-slate-50 dark:bg-slate-700 font-medium text-slate-600 dark:text-slate-300' : ''}`}
          >
            {emptyLabel}
          </button>

          {personas.length > 0 && <div className="my-1 border-t border-slate-100 dark:border-slate-700" />}

          {personas.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${value === p.id ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}
            >
              <Bot className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{p.title}</span>
                {p.description && <span className="block text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{p.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
