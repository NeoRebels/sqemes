// SQEM-142 Phase 2 — role-based template access control. Used in the template editor
// (per-template) and Settings → General (workspace default). v1 = roles only; a per-user
// block can be added in v2. "Everyone" = no restriction rows; admins & the creator always
// have access regardless.
import type { UserRole } from '../types';
import { Users, Lock } from 'lucide-react';

export type TemplateAccessValue = { mode: 'everyone' | 'restricted'; roles: UserRole[] };

/** roles[] (from the DB) → the control's value. Empty ⇒ open to everyone. */
export function rolesToAccessValue(roles: UserRole[]): TemplateAccessValue {
  return roles.length ? { mode: 'restricted', roles } : { mode: 'everyone', roles: [] };
}
/** The control's value → roles[] to persist. */
export function accessValueToRoles(v: TemplateAccessValue): UserRole[] {
  return v.mode === 'everyone' ? [] : v.roles;
}

const RESTRICTABLE: { role: UserRole; label: string }[] = [
  { role: 'editor', label: 'Editors' },
  { role: 'member', label: 'Members' },
];

export function TemplateAccessControl({
  value,
  onChange,
  label = 'Access',
  hint = 'Who can see & use this template',
}: {
  value: TemplateAccessValue;
  onChange: (v: TemplateAccessValue) => void;
  label?: string;
  hint?: string;
}) {
  const setMode = (mode: 'everyone' | 'restricted') => {
    if (mode === value.mode) return;
    // Restricting to an empty set would silently mean "open", so default to Editors.
    onChange(mode === 'everyone' ? { mode, roles: [] } : { mode, roles: value.roles.length ? value.roles : ['editor'] });
  };
  const toggleRole = (role: UserRole) => {
    const has = value.roles.includes(role);
    if (has && value.roles.length === 1) return; // keep at least one role in restricted mode
    onChange({ mode: 'restricted', roles: has ? value.roles.filter(r => r !== role) : [...value.roles, role] });
  };

  const optionClass = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm text-left transition-all ${
      active
        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-slate-900 dark:text-slate-100'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
    }`;

  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</label>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{hint}</p>
      <div className="space-y-2">
        <button type="button" onClick={() => setMode('everyone')} className={optionClass(value.mode === 'everyone')}>
          <Users className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">Everyone</span>
            <span className="block text-xs text-slate-400">All workspace members can use it</span>
          </span>
        </button>
        <button type="button" onClick={() => setMode('restricted')} className={optionClass(value.mode === 'restricted')}>
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">Restrict to roles</span>
            <span className="block text-xs text-slate-400">Choose which roles can use it</span>
          </span>
        </button>
      </div>
      {value.mode === 'restricted' && (
        <div className="mt-3 pl-1 space-y-2">
          {RESTRICTABLE.map(({ role, label: rl }) => (
            <label key={role} className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.roles.includes(role)}
                onChange={() => toggleRole(role)}
                className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-brand-600 focus:ring-brand-500"
              />
              {rl}
            </label>
          ))}
          <p className="text-2xs text-slate-400 dark:text-slate-500 pt-1">Admins &amp; the creator always have access.</p>
        </div>
      )}
    </div>
  );
}
