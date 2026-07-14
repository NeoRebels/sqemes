import React, { useState, useRef, useEffect, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Info } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';

interface ModelSpecs {
  description: string;
  cost: number;
  speed: number;
  thinking: number;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  specs?: ModelSpecs;
}

interface Props {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
  fullWidth?: boolean;
  // When there are no models, show a clickable CTA (e.g. "Add API key") instead
  // of opening an empty dropdown.
  emptyActionLabel?: string;
  emptyActionIcon?: React.ReactNode;
  onEmptyAction?: () => void;
}

const getCostColor = (v: number) =>
  v <= 3 ? 'bg-emerald-50 text-emerald-600' : v <= 7 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';
const getPerfColor = (v: number) =>
  v >= 8 ? 'bg-emerald-50 text-emerald-600' : v >= 4 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600';

export function ModelSelect({
  models,
  value,
  onChange,
  disabled = false,
  emptyLabel = 'No models available',
  fullWidth = false,
  emptyActionLabel,
  emptyActionIcon,
  onEmptyAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) { setHoveredId(null); return; }
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdownWidth = 384; // w-96
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < 320 && spaceAbove > spaceBelow;
    // Clamp left so dropdown doesn't overflow viewport right edge
    const left = Math.min(rect.left, window.innerWidth - dropdownWidth - 8);
    setDropdownStyle({
      position: 'fixed',
      top: openUpward ? undefined : rect.bottom + 4,
      bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
      left: Math.max(left, 8),
      width: dropdownWidth,
      zIndex: 9999,
    });
  }, [open]);

  const selected = models.find(m => m.id === value) ?? null;
  const hoveredModel = hoveredId ? models.find(m => m.id === hoveredId) : null;
  const showEmptyAction = models.length === 0 && !!onEmptyAction;

  const triggerBase = `flex items-center gap-2 appearance-none bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none transition-all ${
    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'
  } ${fullWidth ? 'w-full' : ''}`;

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          if (showEmptyAction) { onEmptyAction!(); return; }
          setOpen(o => !o);
        }}
        className={triggerBase}
      >
        {selected ? (
          <>
            <ProviderIcon provider={selected.provider} className="w-4 h-4 shrink-0" />
            <span className={`truncate ${fullWidth ? 'flex-1 text-left' : 'max-w-[160px]'}`}>{selected.name}</span>
          </>
        ) : showEmptyAction ? (
          <span className={`flex items-center gap-1.5 text-brand-600 dark:text-brand-400 font-semibold ${fullWidth ? 'flex-1' : ''}`}>{emptyActionIcon}{emptyActionLabel}</span>
        ) : (
          <span className={`text-slate-500 font-normal ${fullWidth ? 'flex-1 text-left' : ''}`}>{emptyLabel}</span>
        )}
      </button>
      {!showEmptyAction && (
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}

      {open && createPortal(
        <div ref={dropdownRef} style={dropdownStyle} className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-100 dark:border-slate-700">
          <div className="py-1 max-h-60 overflow-y-auto">
            {models.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">{emptyLabel}</div>
            ) : (
              models.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onChange(m.id); setOpen(false); }}
                  onMouseEnter={() => setHoveredId(m.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${value === m.id ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                >
                  <ProviderIcon provider={m.provider} className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{m.name}</span>
                  {m.specs && (
                    <Info className={`w-3.5 h-3.5 shrink-0 transition-colors ${hoveredId === m.id ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600'}`} />
                  )}
                </button>
              ))
            )}
          </div>

          {hoveredModel?.specs && (
            <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">{hoveredModel.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">{hoveredModel.specs.description}</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <div className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1">Cost</div>
                  <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${getCostColor(hoveredModel.specs.cost)}`}>{hoveredModel.specs.cost}/10</div>
                </div>
                <div className="text-center">
                  <div className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1">Speed</div>
                  <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${getPerfColor(hoveredModel.specs.speed)}`}>{hoveredModel.specs.speed}/10</div>
                </div>
                <div className="text-center">
                  <div className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1">Thinking</div>
                  <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${getPerfColor(hoveredModel.specs.thinking)}`}>{hoveredModel.specs.thinking}/10</div>
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
