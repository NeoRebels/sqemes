import React from 'react';

const baseClasses =
  'w-full border border-line-strong rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all bg-surface-field text-ink-strong placeholder:text-slate-400 dark:placeholder:text-slate-500';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`${baseClasses} px-4 py-3 ${className}`}
      {...props}
    />
  )
);

Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`${baseClasses} p-4 resize-none ${className}`}
      {...props}
    />
  )
);

Textarea.displayName = 'Textarea';

export { Input, Textarea };
export default Input;
