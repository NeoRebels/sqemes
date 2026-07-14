import React from 'react';

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

  return (
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
    </div>
  );
};

export default Modal;
