import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * SQEM-601 — the form field select: one look for every single choice in a form or a Settings card.
 *
 * Before it there were 15 hand-styled selects in 11 variants, six still in the pre-redesign palette
 * (`slate-200`, `bg-white dark:bg-slate-700`, `brand-500` focus) and two with `appearance-none` but no
 * arrow — they read as text fields.
 *
 * - **Native `<select>`**: keyboard, screen readers and the phone's system picker work without code.
 * - **Its own arrow.** `appearance-none` removes the browser's, which differs per browser and is not
 *   drawn at all by Safari once removed — so this component must always render `ChevronDown`.
 * - **`color-scheme: dark` in dark mode**, or the opened option list can stay light: the app sets no
 *   color-scheme anywhere else, and the list is drawn by the browser, not by CSS.
 * - **`className` styles the wrapper** — width and outer spacing (`max-w-md`, `mb-4`). The field
 *   itself is not overridable on purpose; a variant belongs here, named, not at a call site.
 * - Padding matches `ui/Input` (`px-4 py-3`), so a text field and a select side by side are equally tall.
 *
 * Not for toolbar filters — that is `ui/SelectFilter` (its active state is the point there).
 */
const fieldClasses =
  'w-full appearance-none pl-4 pr-10 py-3 bg-surface-field border border-line-strong text-ink-strong rounded-control text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed dark:[color-scheme:dark]';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', children, ...props }, ref) => (
    <div className={`relative w-full ${className}`}>
      <select ref={ref} className={fieldClasses} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
    </div>
  )
);

Select.displayName = 'Select';

export default Select;
