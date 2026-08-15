import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

/**
 * SQEM-208 — the way out of a full-screen surface, in one place.
 *
 * Three routes render outside `<Layout>` and therefore without the main navigation: Chat, the
 * TemplateEditor, and the marketplace detail page. Each had its own back control, in its own
 * styling, and on two of them the only way back into the product was the faintest element on the
 * page. SQEM-206 fixed that for Chat; this makes it the rule instead of a Chat peculiarity.
 *
 * The important design decision is `onExit` rather than a `to` prop. Escape always calls `onExit`
 * — one logic, no per-page special case — and a page that has something to lose passes a callback
 * that guards it. The TemplateEditor passes its existing `handleBack`, so a dirty editor shows its
 * discard dialog rather than navigating away. This component knows nothing about any of that, and
 * must not learn: the guard belongs to the page that owns the state.
 */
export function FullScreenExit({
  label,
  onExit,
  /**
   * Whether Escape leaves. Off in the TemplateEditor: an editor has many local Escape consumers
   * (dropdowns, tag picker, test panel, several modals), and every one that isn't enumerated here
   * would become a case where Escape tries to leave the page while the user only meant to close a
   * menu. Chat's states were knowable and complete; an editor's are not. Turning this on there is a
   * one-word change if that judgement turns out to be wrong.
   */
  escapeEnabled = false,
  /** Set false while something more local should consume Escape (open menu, modal, rename…). */
  escapeReady = true,
  className = '',
}: {
  label: string;
  onExit: () => void;
  escapeEnabled?: boolean;
  escapeReady?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!escapeEnabled || !escapeReady) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Never steal Escape from someone who is typing.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      onExit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [escapeEnabled, escapeReady, onExit]);

  return (
    <button
      onClick={onExit}
      title={escapeEnabled ? `${label} (Esc)` : label}
      className={`group inline-flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors text-sm ${className}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <ArrowLeft className="w-4 h-4 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {escapeEnabled && (
        <kbd className="hidden sm:inline text-2xs font-sans font-semibold px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500 shrink-0">
          Esc
        </kbd>
      )}
    </button>
  );
}

export default FullScreenExit;
