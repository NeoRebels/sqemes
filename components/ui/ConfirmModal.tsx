import React, { useId, useState } from 'react';
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
  confirmText,
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
  /**
   * SQEM-539 — when set, the person types this text before Confirm unlocks. Reserved for what
   * cannot be undone at the scale of a whole workspace; a single playbook does not get it.
   */
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const locked = confirmText !== undefined && typed.trim() !== confirmText.trim();
  // The typed text is cleared on the way out, so the next opening starts empty.
  const close = () => { setTyped(''); onClose(); };
  const confirm = () => { setTyped(''); onConfirm(); };
  return (
    <Modal open={open} onClose={close} size="sm" className="p-6">
      {/* SQEM-554 (a) — the display face for the title, as C does for every heading from 20 px. */}
      <h3 className="font-display text-xl font-semibold text-ink-strong mb-2">{title}</h3>
      <div className="text-sm text-ink-muted mb-6 space-y-2">{children}</div>
      {confirmText !== undefined && (
        <div className="mb-6">
          <label htmlFor={inputId} className="block text-xs font-bold text-ink-muted mb-1.5">
            Type <span className="font-mono text-ink-strong">{confirmText}</span> to confirm
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off"
            className="w-full p-2.5 border border-line-strong bg-surface-field text-ink-strong rounded-control text-sm outline-none focus:border-danger focus:ring-2 focus:ring-danger/20"
          />
        </div>
      )}
      <div className="flex gap-2">
        {/* Cancel is a plain button, not a `Button` with a variant: it must read as the quiet way
            out. Giving both actions the same weight is how a confirmation stops being one.
            SQEM-554 (a) kept that on purpose and only moved its colours to the tokens. */}
        <button
          onClick={close}
          disabled={busy}
          className="flex-1 py-2.5 text-ink-muted bg-surface-sunken rounded-control hover:text-ink-strong hover:bg-line-strong text-xs font-bold transition-colors disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <Button
          variant={variant}
          onClick={confirm}
          loading={busy}
          disabled={locked}
          className={`flex-1 py-2.5 text-xs shadow-lg ${variant === 'danger' ? 'hover:shadow-red-200' : 'hover:shadow-brand-200'}`}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
