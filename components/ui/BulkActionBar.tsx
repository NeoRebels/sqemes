import React from 'react';
import { Trash2, X } from 'lucide-react';

// SQEM-077 — sticky bar shown when ≥1 item is selected on a list/grid page.
// Shared by Files and Templates. The parent owns the selection state.

export default function BulkActionBar({
  count,
  total,
  allSelected,
  onToggleSelectAll,
  onDelete,
  onClear,
  noun,
}: {
  count: number;
  total: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onDelete: () => void;
  onClear: () => void;
  noun: string;
}) {
  return (
    <div className="sticky top-2 z-20 mb-4 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900 dark:bg-slate-700 text-white shadow-lg">
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
