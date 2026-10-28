import React, { useState } from 'react';
import { X, Plus, Tag } from 'lucide-react';
import { m } from '../../lib/i18n';

// SQEM-073 — shared inline tag editor: chips with a hover remove (×) plus a
// "+ tag" picker sourced from the workspace tag registry. Presentational /
// controlled — the parent owns the tags and persistence and supplies
// `available` (workspace tags that can still be added). Pass `available={[]}`
// to suppress the add affordance, e.g. for a single-tag item that already has
// a tag, or when the user can't edit. Used by both file rows and template cards.

export default function TagEditor({
  tags,
  available,
  canEdit = true,
  onAdd,
  onRemove,
}: {
  tags: string[];
  available: string[];
  canEdit?: boolean;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <>
      {tags.map(tag => (
        <span
          key={tag}
          className="group/tag flex items-center gap-1 text-xs font-semibold px-2 py-0.5 bg-slate-50 dark:bg-slate-700 text-ink-muted rounded-lg uppercase tracking-wide"
        >
          {tag}
          {canEdit && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(tag); }}
              className="relative hit-24 reveal-on-hover transition-opacity ml-0.5 text-slate-400 hover:text-slate-600"
              title={m.tag_remove()}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </span>
      ))}
      {canEdit && available.length > 0 && (
        picking ? (
          <select
            value=""
            onChange={e => { onAdd(e.target.value); setPicking(false); }}
            onBlur={() => setPicking(false)}
            autoFocus
            aria-label={m.tag_add_label()}
            className="text-xs px-2 py-0.5 border border-brand-300 rounded-lg outline-none focus:border-brand-500 bg-surface-field text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="" disabled>{m.tag_choose()}</option>
            {available.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        ) : (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); setPicking(true); }}
            className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-brand-500 transition-colors"
            title={m.tag_add()}
          >
            <Plus className="w-3 h-3" />
            <Tag className="w-2.5 h-2.5" />
          </button>
        )
      )}
    </>
  );
}
