import React from 'react';

/**
 * SQEM-602 — the form text field and text area, aligned with `ui/Select` (SQEM-601): design tokens,
 * focus in `accent`, a disabled style, `color-scheme: dark` in dark mode (date pickers, autofill), and
 * 46 px (`px-4 py-3`) like the select beside it.
 *
 * Before: 52 hand-styled fields in 36 variants, 23 in the pre-redesign palette, while this component
 * was used ten times and `Textarea` never.
 *
 * ⚠️ `className` is appended to the field. Tailwind resolves a conflict by the order of the generated
 * CSS, not by the order in `className`: `pl-10` (room for an icon) beats `px-4`, but `text-xs` loses to
 * `text-sm`. Pass layout and adornment room here (margins, `flex-1`, `font-mono`, `pl-10`, `pr-12`);
 * a different look is a named variant in this file, not a call-site override. Settings uses `!w-auto`
 * where a field must not be full width inside a flex row.
 *
 * `Textarea` sets no `resize-*`: whether a text area may be resized is the call site's decision.
 *
 * **`tone`** is the field's state, and the one sanctioned variant: `error` (a value that will be
 * rejected — pair it with `aria-invalid` and a message), `warning` (allowed but worth a look),
 * `success` (already configured — the provider-key fields). Six call sites used to build these with
 * template strings over a full class list; a state is not a look a call site should own.
 */
export type FieldTone = 'default' | 'error' | 'warning' | 'success';

const baseClasses =
  'w-full border rounded-control text-sm outline-none focus:ring-2 transition-all text-ink-strong placeholder:text-ink-subtle disabled:opacity-60 disabled:cursor-not-allowed dark:[color-scheme:dark]';

const toneClasses: Record<FieldTone, string> = {
  default: 'border-line-strong bg-surface-field focus:border-accent focus:ring-accent/20',
  error: 'border-danger bg-surface-field focus:border-danger focus:ring-danger/20',
  warning: 'border-warning bg-surface-field focus:border-warning focus:ring-warning/20',
  success: 'border-success/40 bg-success-soft focus:border-accent focus:ring-accent/20',
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  tone?: FieldTone;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', tone = 'default', ...props }, ref) => (
    <input
      ref={ref}
      className={`${baseClasses} ${toneClasses[tone]} px-4 py-3 ${className}`}
      {...props}
    />
  )
);

Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: FieldTone;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', tone = 'default', ...props }, ref) => (
    <textarea
      ref={ref}
      className={`${baseClasses} ${toneClasses[tone]} px-4 py-3 ${className}`}
      {...props}
    />
  )
);

Textarea.displayName = 'Textarea';

export { Input, Textarea };
export default Input;
