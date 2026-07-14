import React, { useState } from 'react';
import { X, Tag, Plus } from 'lucide-react';
import PickerDropdown from './ui/PickerDropdown';

// SQEM-074 — single-select tag picker for the template editor, styled like the
// context-file picker (searchable dropdown). Picks from the workspace tag
// registry (`workspace.tags`).

interface Props {
  value: string | null;
  tags: string[];
  onChange: (tag: string | null) => void;
  disabled?: boolean;
  onCreate?: (name: string) => void;
}

export function TagPicker({ value, tags, onChange, disabled = false, onCreate }: Props) {
  const [search, setSearch] = useState('');

  const available = tags.filter(t =>
    t !== value && t.toLowerCase().includes(search.toLowerCase())
  );

  const trimmed = search.trim();
  const canCreate = !!onCreate && trimmed.length > 0
    && !tags.some(t => t.toLowerCase() === trimmed.toLowerCase());

  return (
    <div>
      {/* Selected tag chip */}
      {value && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="inline-flex items-center gap-1 bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 px-2 py-1 rounded-lg text-xs font-medium uppercase tracking-wide">
            <Tag className="w-3 h-3 shrink-0" />
            <span>{value}</span>
            {!disabled && (
              <button type="button" onClick={() => onChange(null)} className="hover:text-slate-900 dark:hover:text-slate-100 ml-0.5 shrink-0">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        </div>
      )}

      <PickerDropdown
        disabled={disabled}
        triggerIcon={<Tag className="w-3.5 h-3.5 shrink-0" />}
        triggerLabel={value ? 'Change tag...' : 'Select a tag...'}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search tags..."
        footer={canCreate ? (close) => (
          <button
            type="button"
            onClick={() => { onCreate!(trimmed); close(); }}
            className="w-full text-left px-3 py-2 flex items-center gap-2 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold">Create &ldquo;{trimmed}&rdquo;</span>
          </button>
        ) : undefined}
      >
        {(close) => (
          available.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              {tags.length === 0 ? 'No tags in workspace' : search ? 'No tags match your search' : 'No other tags'}
            </div>
          ) : (
            available.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { onChange(t); close(); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <Tag className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200 uppercase tracking-wide">{t}</span>
              </button>
            ))
          )
        )}
      </PickerDropdown>
    </div>
  );
}
