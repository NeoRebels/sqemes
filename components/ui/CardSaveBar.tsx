import React from 'react';
import { Save } from 'lucide-react';
import Button from './Button';
import { m } from '../../lib/i18n';

/**
 * SQEM-539 — the save row at the bottom of a settings card.
 *
 * Settings saves on a click, never as a side effect of choosing a value. Before
 * this, four controls wrote the moment they were touched while the hint beside one of them said
 * "applies after this is saved" — the screen described a model it did not have. A card that edits a
 * value keeps a draft and shows this row; nothing is written until Save.
 *
 * Always rendered, disabled while clean: a Save button that appears only after a change would hide
 * the one fact the person needs — that this card does not save by itself.
 */
export default function CardSaveBar({
  dirty,
  saving = false,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-end gap-2">
      {dirty && <span className="mr-auto text-xs text-ink-muted">{m.save_unsaved()}</span>}
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty || saving}
        className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {m.save_cancel()}
      </button>
      <Button size="sm" onClick={onSave} disabled={!dirty} loading={saving}>
        <Save className="w-4 h-4" /> {m.save_save()}
      </Button>
    </div>
  );
}
