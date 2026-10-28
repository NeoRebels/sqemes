import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Input from './Input';
import { m } from '../../lib/i18n';

/**
 * SQEM-386 — a password-style input with a show/hide toggle.
 *
 * Born in the setup wizard's key step: a UX tester (2026-09-11) pasted a key and had no way to check
 * what he had pasted. Takes every `<input>` prop except `type`, which it owns. The wrapper is
 * `relative` and fills its parent. SQEM-602 — the field is `ui/Input`, so it looks like every other
 * text field; `className` carries layout (`font-mono`), `tone` the state (the wizard's "already
 * configured" green). ⚠️ Settings → Integrations has the same fields and does not
 * use this yet — it can, and should, when it is next touched.
 */
export default function SecretInput({
  className = '',
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative flex-1 min-w-0">
      <Input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-10`} />
      <button
        type="button"
        aria-label={shown ? m.si_hide() : m.si_show()}
        aria-pressed={shown}
        onClick={() => setShown(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
      >
        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
