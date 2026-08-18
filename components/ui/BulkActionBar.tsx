import React from 'react';
import { Trash2, X, Download, Loader2, Tag as TagIcon } from 'lucide-react';

// SQEM-077 — sticky bar shown when ≥1 item is selected on a list/grid page.
// Shared by Files and Templates. The parent owns the selection state.
// SQEM-161 — optional Export action (Templates uses it for the .sqemes.zip bundle export).
// SQEM-253 — optional tag actions (Files). **Add and remove are separate controls on purpose:** one
// control that adds for some of the selection and removes for the rest is the kind of thing a person
// gets wrong once and then avoids. Each lists only what it can act on, so neither ever no-ops.

export default function BulkActionBar({
  count,
  total,
  allSelected,
  onToggleSelectAll,
  onDelete,
  onClear,
  noun,
  onExport,
  exporting,
  addableTags,
  removableTags,
  onAddTag,
  onRemoveTag,
  tagBusy,
}: {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onDelete: () => void;
  onClear: () => void;
  noun: string;
  onExport?: () => void;
  exporting?: boolean;
  /** The workspace tag vocabulary. Nothing here may create a tag — see Files.tsx. */
  addableTags?: string[];
  /** Tags carried by at least one selected item. */
  removableTags?: string[];
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  tagBusy?: boolean;
}) {
  // A select that fires and resets: its value is an action, not a state, so it must not appear to
  // remember a choice that has already been applied.
  const tagSelect = (
    label: string,
    options: string[],
    onPick: (tag: string) => void,
  ) => (
    <div className="relative flex items-center">
      <TagIcon className="absolute left-2.5 w-3.5 h-3.5 text-slate-300 pointer-events-none" />
      <select
        value=""
        disabled={tagBusy || options.length === 0}
        onChange={e => { const v = e.target.value; e.target.value = ''; if (v) onPick(v); }}
        aria-label={label}
        className="pl-7 pr-6 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg appearance-none cursor-pointer outline-none disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <option value="">{label}</option>
        {options.map(t => (
          <option key={t} value={t} className="text-slate-900">{t}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white shadow-lg">
      <span className="text-sm font-semibold">
        {count} {noun}{count === 1 ? '' : 's'} selected
      </span>
      <button
        type="button"
        onClick={onToggleSelectAll}
        className="text-xs font-medium text-slate-300 hover:text-white transition-colors"
      >
        {allSelected ? 'Deselect all' : `Select all ${total}`}
      </button>
      <div className="flex-1" />
      {tagBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-300" />}
      {onAddTag && tagSelect('Add tag', addableTags ?? [], onAddTag)}
      {onRemoveTag && (removableTags?.length ?? 0) > 0 && tagSelect('Remove tag', removableTags ?? [], onRemoveTag)}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Export
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        className="p-1.5 text-slate-300 hover:text-white rounded-lg transition-colors"
        title="Clear selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
