import React from 'react';
import Modal from './Modal';
import Button from './Button';

/**
 * SQEM-329 — the confirmation dialog, in one place.
 *
 * Written because three places were still calling the browser's own `confirm()`, and because the
 * hand-rolled replacements were about to be copied a fourth time. The shape is not invented here —
 * it is the one `TemplateEditor` has used since the beginning (*Unsaved Changes*, *Delete Prompt?*):
 * title, one paragraph, two equal-width buttons, the dangerous one on the right.
 *
 * ⛔ **Why a native `confirm()` had to go, beyond looking foreign.** It ignores the dark theme,
 * renders differently in every browser, cannot be styled or made keyboard-consistent with the rest
 * of the app — and it **blocks the JavaScript thread entirely**, which freezes any automated
 * session until a human clicks it. That last one is not theoretical here.
 *
 * This is the rule from `components/ui/Checkbox.tsx` applied again: reach for the primitives, and
 * add to the directory when the one you need is missing. That file records what happens otherwise —
 * thirteen hand-rolled checkboxes in six class combinations, two of them the wrong purple.
 */
export default function ConfirmModal({
  open,
  title,
  /** The body. A node rather than a string, because some of these have to name what will be lost. */
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  /** `danger` for anything destructive; `primary` when the action merely proceeds. */
  variant = 'danger',
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" className="p-6">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-6 space-y-2">{children}</div>
      <div className="flex gap-2">
        {/* Cancel is a plain button, not a `Button` with a variant: it must read as the quiet way
            out. Giving both actions the same weight is how a confirmation stops being one. */}
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 py-2.5 text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-600 text-xs font-bold transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <Button
          variant={variant}
          onClick={onConfirm}
          loading={busy}
          className={`flex-1 py-2.5 text-xs shadow-lg ${variant === 'danger' ? 'hover:shadow-red-200' : 'hover:shadow-brand-200'}`}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
