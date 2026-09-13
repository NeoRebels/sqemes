import React, { useRef } from 'react';
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
  return createPortal(
    <div
      className={[
        'fixed inset-0 backdrop-blur-sm z-50 overflow-y-auto overscroll-contain',
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
          className={[
            'bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 animate-scale-up w-full',
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
