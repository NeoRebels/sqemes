import React from 'react';
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
  if (!open) return null;

  // Portal to <body> so the overlay is always viewport-fixed and full-page (backdrop blur + centred),
  // even when the modal is rendered inside a transformed ancestor — e.g. a tab pane with
  // `.animate-fade-in` (transform: forwards), which would otherwise become the containing block for
  // `position: fixed` and clip/confine the overlay to that pane. (SQEM-149)
  return createPortal(
    <div
      className={[
        'fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-4',
        overlayOpacity === 'high' ? 'bg-slate-900/50' : 'bg-slate-900/20',
      ].join(' ')}
      onClick={onClose}
    >
      <div
        className={[
          'bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 animate-scale-up w-full',
          sizeClasses[size],
          className,
        ].join(' ')}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
