import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  size?: ModalSize;
  overlayOpacity?: 'low' | 'high';
  className?: string;
  children: React.ReactNode;
}

/**
 * SQEM-535 — the open modals, innermost last. Escape and the Tab trap act only for the top one, so
 * a confirmation opened from inside another dialog closes alone and leaves its parent standing.
 */
const openStack: object[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const focusables = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest('[hidden], [inert]'));

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
};

const Modal = ({ open, onClose, size = 'sm', overlayOpacity = 'low', className = '', children }: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * SQEM-382 — where the press BEGAN, so a drag-select cannot close the dialog.
   *
   * ⛔ A `click` fires on the nearest common ancestor of mouse-down and mouse-up. Start a text
   * selection inside the panel, release outside it, and the browser reports a click on the
   * overlay — which used to close the modal. In a UX test (2026-09-08) that dismissed the Setup
   * Wizard mid-sentence, and `SetupWizard` treats a dismissal as "not finished", not "done".
   *
   * Tri-state on purpose: `null` = no mouse-down observed (a keyboard or programmatic click on the
   * overlay), and that still closes, exactly as before. Only a press that provably began INSIDE
   * the panel is refused. A press that began outside and was released inside still closes — the
   * press decides, which is what Radix and Headless UI do too.
   *
   * ⛔ Do NOT "simplify" this to `stopPropagation` on the panel's `mousedown`. Eight components
   * (`PickerDropdown`, `ModelSelect`, `PersonaSelect`, `Sidebar`, `Files`, three in `Chat`)
   * close their dropdowns from a `mousedown` listener on `document`; a stopped `mousedown` never
   * gets there, and every dropdown inside a modal would stop closing. The `contains` check below
   * changes nothing about propagation. `tests/unit/modalDragSelect.test.ts` pins both halves.
   */
  const pressBeganInside = useRef<boolean | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const fallbackLabelId = useId();

  /**
   * SQEM-535 — a dialog, not a box: name, Escape, focus in and focus back.
   *
   * ⛔ The listener sits on `document` in the BUBBLE phase, not on `window` and not in capture.
   * - A handler inside the dialog sees Escape first and can claim it with `preventDefault()` (the
   *   provider dropdown in `SetupWizard` does: Escape closes the dropdown, not the wizard). React
   *   listens on the portal container (`body`), which is below `document` on the event path.
   * - `FullScreenExit` listens on `window`, which comes after `document`. It skips an Escape that is
   *   already `defaultPrevented` — before this, Escape in the report dialog of a marketplace listing
   *   left the whole page.
   *
   * The name is the first heading in the panel, wired imperatively so none of the call sites had to
   * change. Without `onClose` (an upload is running) Escape does nothing, like a click beside it —
   * but it is still swallowed, so it cannot leave the page underneath either.
   */
  useEffect(() => {
    if (!open) return;
    const token = {};
    openStack.push(token);
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (panel) {
      const heading = panel.querySelector<HTMLElement>('h1, h2, h3, h4');
      if (heading) {
        if (!heading.id) heading.id = fallbackLabelId;
        panel.setAttribute('aria-labelledby', heading.id);
      }
      // An `autoFocus` field inside already has focus; leave it there.
      if (!panel.contains(document.activeElement)) (focusables(panel)[0] ?? panel).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== token || !panel) return;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = openStack.indexOf(token);
      if (i !== -1) openStack.splice(i, 1);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open, fallbackLabelId]);

  if (!open) return null;

  // Portal to <body> so the overlay is always viewport-fixed and full-page (backdrop blur + centred),
  // even when the modal is rendered inside a transformed ancestor — e.g. a tab pane with
  // `.animate-fade-in` (transform: forwards), which would otherwise become the containing block for
  // `position: fixed` and clip/confine the overlay to that pane. (SQEM-149)
  //
  // ⛔ SQEM-360 — the overlay used to be the flex container itself: `fixed inset-0 flex items-center
  // justify-center p-4`, with no scroll anywhere. Content taller than the viewport was therefore
  // centred and cut off **at both ends**, and because the overlay is `position: fixed` there was
  // nothing to scroll to reach it. With `items-center` the top overflow is not merely hidden but
  // unreachable — the classic flex-centring trap. On a phone that meant the buttons of the longer
  // dialogs (a key's permission list, an import preview, the connector picker) simply did not exist.
  //
  // The fix is the scroll container + `min-h-full` wrapper pattern, and it is chosen over putting a
  // `max-h` on the panel for one specific reason: **four call sites already pass their own
  // `max-h-[80vh]`/`85vh` through `className`**, and two competing `max-h-*` utilities have equal
  // specificity — which one wins would depend on the order Tailwind happens to emit them. This
  // structure adds no height utility at all, so those four keep capping themselves exactly as before
  // while everything else simply scrolls.
  //
  // ⛔ SQEM-520 — `z-[90]`, not `z-50`: a modal opened from the marketplace moderation drawer
  // (`z-[80]`) used to sit UNDER it, so "Confirm" on a rejection only closed the drawer and a new
  // publisher token appeared behind it. Above every other fixed layer (drawer 80, sidebar dialog 70),
  // below the toast and the chat search (100) and the click-through staging banner (200).
  // `tests/unit/modalLayer.test.ts` pins the order.
  return createPortal(
    <div
      role="presentation"
      className={[
        'fixed inset-0 backdrop-blur-sm z-[90] overflow-y-auto overscroll-contain',
        overlayOpacity === 'high' ? 'bg-slate-900/50' : 'bg-slate-900/20',
      ].join(' ')}
      onMouseDown={e => { pressBeganInside.current = panelRef.current?.contains(e.target as Node) ?? false; }}
      onClick={() => {
        const refuse = pressBeganInside.current === true;
        pressBeganInside.current = null;
        if (!refuse) onClose?.();
      }}
    >
      {/* `min-h-full` keeps short dialogs vertically centred (the previous behaviour, unchanged);
          a tall one grows past it and scrolls the overlay instead of being clipped. */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          className={[
            'focus:outline-none',
            // SQEM-554 (a) — the dialog tokens (same values as the 2xl pair they replace).
            'bg-surface-raised rounded-overlay shadow-overlay border border-line animate-scale-up w-full',
            sizeClasses[size],
            className,
          ].join(' ')}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
