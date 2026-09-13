import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * SQEM-386 — a password-style input with a show/hide toggle.
 *
 * Born in the setup wizard's key step: a UX tester (2026-09-11) pasted a key and had no way to check
 * what he had pasted. Takes every `<input>` prop except `type`, which it owns. The wrapper is
 * `relative` and fills its parent; pass sizing/border classes through `className` as you would on
 * the bare input. ⚠️ Settings → Integrations has the same fields and does not use this yet — it can,
 * and should, when it is next touched.
 */
export default function SecretInput({
  className = '',
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex-1 min-w-0">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} w-full pr-10`} />
      <button
        type="button"
        aria-label={shown ? 'Hide key' : 'Show key'}
        aria-pressed={shown}
        onClick={() => setShown(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
