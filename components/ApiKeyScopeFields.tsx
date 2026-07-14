import React from 'react';
import { Check, Clock } from 'lucide-react';

// SQEM-064 — scope + expiry controls for an MCP/API connection.
// `read` is always granted (a key with no read is useless), so it is implied
// and only create/update/delete are toggleable.

export type KeyScopeValue = {
  create: boolean;
  update: boolean;
  delete: boolean;
  expiry: 'never' | '30' | '90' | 'custom';
  customDate: string; // yyyy-mm-dd, only used when expiry === 'custom'
};

// Default for newly-created keys: read + create + update, no delete, never expires.
export const DEFAULT_KEY_SCOPE: KeyScopeValue = {
  create: true,
  update: true,
  delete: false,
  expiry: 'never',
  customDate: '',
};

// Full access — used as the SetupWizard / fallback default.
export const FULL_KEY_SCOPE: KeyScopeValue = {
  create: true,
  update: true,
  delete: true,
  expiry: 'never',
  customDate: '',
};

export function scopeArrayFromValue(v: KeyScopeValue): string[] {
  const scopes = ['read'];
  if (v.create) scopes.push('create');
  if (v.update) scopes.push('update');
  if (v.delete) scopes.push('delete');
  return scopes;
}

export function expiresAtFromValue(v: KeyScopeValue): string | null {
  if (v.expiry === 'never') return null;
  if (v.expiry === 'custom') {
    return v.customDate ? new Date(`${v.customDate}T23:59:59`).toISOString() : null;
  }
  const days = v.expiry === '30' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function valueFromKey(scopes: string[] | null, expiresAt: string | null): KeyScopeValue {
  const s = scopes && scopes.length > 0 ? scopes : ['read', 'create', 'update', 'delete'];
  return {
    create: s.includes('create'),
    update: s.includes('update'),
    delete: s.includes('delete'),
    expiry: expiresAt ? 'custom' : 'never',
    customDate: expiresAt ? new Date(expiresAt).toISOString().slice(0, 10) : '',
  };
}

const CAPS: { key: 'create' | 'update' | 'delete'; label: string; hint: string }[] = [
  { key: 'create', label: 'Create templates & upload files', hint: 'create_template, upload_file' },
  { key: 'update', label: 'Update templates', hint: 'update_template' },
  { key: 'delete', label: 'Delete templates', hint: 'delete_template' },
];

export function ApiKeyScopeFields({
  value,
  onChange,
}: {
  value: KeyScopeValue;
  onChange: (v: KeyScopeValue) => void;
}) {
  const set = (patch: Partial<KeyScopeValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Permissions</p>
        <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500 mb-2">
          <Check className="w-4 h-4 text-emerald-500" />
          Read templates &amp; files — always included
        </div>
        <div className="space-y-2">
          {CAPS.map(cap => (
            <label key={cap.key} className="flex items-start gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={value[cap.key]}
                onChange={e => set({ [cap.key]: e.target.checked })}
                className="mt-0.5 w-4 h-4 rounded accent-violet-600 cursor-pointer"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200 leading-tight">
                {cap.label}
                <span className="block text-2xs font-mono text-slate-400 dark:text-slate-500">{cap.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> Expires
        </label>
        <select
          value={value.expiry}
          onChange={e => set({ expiry: e.target.value as KeyScopeValue['expiry'] })}
          className="w-full p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
        >
          <option value="never">Never</option>
          <option value="30">In 30 days</option>
          <option value="90">In 90 days</option>
          <option value="custom">Custom date…</option>
        </select>
        {value.expiry === 'custom' && (
          <input
            type="date"
            value={value.customDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => set({ customDate: e.target.value })}
            className="w-full mt-2 p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all"
          />
        )}
      </div>
    </div>
  );
}
