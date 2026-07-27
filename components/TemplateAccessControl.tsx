// SQEM-142 Phase 2 — role-based template access control. SQEM-143 v2 — optional per-user
// overrides. Used in the template editor (per-template, with a member picker) and Settings →
// General + onboarding (workspace default, roles only). "Everyone" = no restriction rows;
// admins & the creator always have access regardless.
import { useMemo, useState } from 'react';
import type { UserRole, User } from '../types';
import { Users, Lock, Search } from 'lucide-react';

export type TemplateAccessValue = { mode: 'everyone' | 'restricted'; roles: UserRole[]; userIds: string[] };

/** roles[] (from the DB) → the control's value. Empty ⇒ open to everyone. (Roles only — for the
 *  workspace default, which has no per-user dimension.) */
export function rolesToAccessValue(roles: UserRole[]): TemplateAccessValue {
  return roles.length ? { mode: 'restricted', roles, userIds: [] } : { mode: 'everyone', roles: [], userIds: [] };
}
/** The control's value → roles[] to persist (workspace default). */
export function accessValueToRoles(v: TemplateAccessValue): UserRole[] {
  return v.mode === 'everyone' ? [] : v.roles;
}

/** roles[] + userIds[] (from the DB) → the control's value. Both empty ⇒ open to everyone. */
export function accessToValue(roles: UserRole[], userIds: string[]): TemplateAccessValue {
  return roles.length || userIds.length
    ? { mode: 'restricted', roles, userIds }
    : { mode: 'everyone', roles: [], userIds: [] };
}
/** The control's value → the { roles, userIds } to persist (per-template). */
export function accessValueToAccess(v: TemplateAccessValue): { roles: UserRole[]; userIds: string[] } {
  return v.mode === 'everyone' ? { roles: [], userIds: [] } : { roles: v.roles, userIds: v.userIds };
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
  members,
}: {
  value: TemplateAccessValue;
  onChange: (v: TemplateAccessValue) => void;
  label?: string;
  hint?: string;
  /** When provided, a per-user override picker is shown under "Restrict". Omit for the
   *  workspace default (roles only). */
  members?: User[];
}) {
  const [memberSearch, setMemberSearch] = useState('');
  const principalCount = value.roles.length + value.userIds.length;

  const setMode = (mode: 'everyone' | 'restricted') => {
    if (mode === value.mode) return;
    // Restricting to an empty set would silently mean "open", so default to Editors.
    onChange(
      mode === 'everyone'
        ? { mode, roles: [], userIds: [] }
        : { mode, roles: value.roles.length || value.userIds.length ? value.roles : ['editor'], userIds: value.userIds },
    );
  };
  const toggleRole = (role: UserRole) => {
    const has = value.roles.includes(role);
    if (has && principalCount === 1) return; // keep at least one principal in restricted mode
    onChange({ ...value, mode: 'restricted', roles: has ? value.roles.filter(r => r !== role) : [...value.roles, role] });
  };
  const toggleUser = (userId: string) => {
    const has = value.userIds.includes(userId);
    if (has && principalCount === 1) return; // keep at least one principal
    onChange({ ...value, mode: 'restricted', userIds: has ? value.userIds.filter(u => u !== userId) : [...value.userIds, userId] });
  };

  const optionClass = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm text-left transition-all ${
      active
        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-slate-900 dark:text-slate-100'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
    }`;

  // Admins always have access (as does the creator), so listing them as grantable is a no-op —
  // only editors and members are meaningfully restrictable per-person. Editors are NOT
  // auto-granted; they only gain access via the Editors role or an individual grant here.
  const grantableMembers = useMemo(() => (members ?? []).filter(m => m.role !== 'admin'), [members]);
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return grantableMembers;
    return grantableMembers.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [grantableMembers, memberSearch]);

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
            <span className="font-semibold">Restrict access</span>
            <span className="block text-xs text-slate-400">Choose roles{members ? ' or specific people' : ''} who can use it</span>
          </span>
        </button>
      </div>
      {value.mode === 'restricted' && (
        <div className="mt-3 pl-1 space-y-2">
          {RESTRICTABLE.map(({ role, label: rl }) => (
            <label key={role} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.roles.includes(role)}
                onChange={() => toggleRole(role)}
                className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
              />
              {rl}
            </label>
          ))}

          {grantableMembers.length > 0 && (
            <div className="pt-2">
              <p className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Specific people</p>
              {grantableMembers.length > 6 && (
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    placeholder="Search people…"
                    className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:ring-brand-500 focus:border-brand-500"
                  />
                </div>
              )}
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {filteredMembers.map(m => (
                  <label key={m.id} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={value.userIds.includes(m.id)}
                      onChange={() => toggleUser(m.id)}
                      className="mt-0.5 w-4 h-4 rounded accent-brand-600 cursor-pointer shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{m.name || m.email}</span>
                      {m.name && <span className="block text-2xs text-slate-400 truncate">{m.email}</span>}
                    </span>
                  </label>
                ))}
                {filteredMembers.length === 0 && (
                  <p className="text-2xs text-slate-400 py-1">No people match “{memberSearch}”.</p>
                )}
              </div>
            </div>
          )}

          <p className="text-2xs text-slate-400 dark:text-slate-500 pt-1">Admins &amp; the creator always have access.</p>
        </div>
      )}
    </div>
  );
}
