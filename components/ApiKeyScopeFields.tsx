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

/**
 * SQEM-353 — what this person is allowed to *choose*, regardless of what the form currently holds.
 *
 * ⛔ SQEM-349 disabled the checkboxes for members and left `DEFAULT_KEY_SCOPE` alone — and that
 * default carries `create: true, update: true`. A member therefore opened the dialog with two boxes
 * ticked, could not untick them, and their key was written with `['read','create','update']`.
 *
 * ⚠️ **A disabled checkbox prevents the click, not the value.** That is the whole bug, and it is the
 * second time in two days that a hardcoded default was the real cause while attention was on the
 * mechanism next to it (SQEM-348 was the same shape, with a name instead of a scope).
 *
 * ⚠️ Clamps by the authority of **whoever is saving**, not of the key's owner. An admin editing
 * somebody else's key therefore does not clamp. Looking the owner's role up costs a query for
 * cosmetic correctness on a value that is inert either way — deliberately not worth it.
 */
export function clampScopeToAuthority(v: KeyScopeValue, canWrite: boolean): KeyScopeValue {
  if (canWrite) return v;
  return { ...v, create: false, update: false, delete: false };
}

/** The starting point for a new key, narrowed to what this person may actually grant (SQEM-353). */
export function defaultScopeFor(canWrite: boolean): KeyScopeValue {
  return clampScopeToAuthority(DEFAULT_KEY_SCOPE, canWrite);
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

/**
 * What each permission actually grants, tool by tool.
 *
 * ⛔ **This list had drifted twice before SQEM-348 corrected it**, and both gaps were of the same
 * kind: a tool was added to `TOOL_CAPABILITY` in `mcp-server` and nobody thought of the checkbox
 * that hands it out. `delete_file` was missing from `delete` (SQEM-234), and every persona tool was
 * missing from all three (SQEM-337/338).
 *
 * ⚠️ **A wrong list here is worse than none.** It is the only place a person sees what they are
 * granting, and it was quietly promising less than it gave. Someone ticking "Delete templates" was
 * also handing out `delete_file` and `delete_persona`.
 *
 * `tests/unit/apiKeyScopeHints.test.ts` now compares these hints against `TOOL_CAPABILITY` itself
 * and fails when a tool is missing — the same shape as `mcpToolCapability.test.ts`. **Adding a tool
 * to the map without listing it here is a red build, not a silent promise.**
 */
const CAPS: { key: 'create' | 'update' | 'delete'; label: string; hint: string }[] = [
  {
    key: 'create',
    label: 'Create templates & personas, upload files',
    hint: 'create_template, create_persona, import_skill_from_url, upload_file, create_upload_url, finalize_upload',
  },
  {
    key: 'update',
    label: 'Update templates & personas, change persona routes',
    hint: 'update_template, update_persona, attach_template, detach_template',
  },
  {
    key: 'delete',
    label: 'Delete templates, personas & files',
    hint: 'delete_template, delete_persona, delete_file',
  },
];

export function ApiKeyScopeFields({
  value,
  onChange,
  canWrite = true,
}: {
  value: KeyScopeValue;
  onChange: (v: KeyScopeValue) => void;
  /**
   * SQEM-349 — may the person configuring this connection write at all?
   *
   * Since SQEM-341 the **role** grants and the scope only narrows, so a member ticking *Create*
   * stored something that could never take effect. Worse, `tools/list` then advertised the tool and
   * `tools/call` refused it — which reads as a broken product rather than a permission.
   *
   * ⚠️ **Already-stored ticks stay visible, just not changeable.** Hiding them would be a second
   * untruth: the row really does carry those scopes, they are simply inert. That case is not
   * hypothetical — an editor's key keeps its scopes after a demotion.
   */
  canWrite?: boolean;
}) {
  const set = (patch: Partial<KeyScopeValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Permissions</p>
        <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500 mb-2">
          <Check className="w-4 h-4 text-emerald-500" />
          Read templates, files &amp; personas — always included
        </div>
        {!canWrite && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            Members can read the library but not change it, so these cannot be granted here. A
            workspace admin can make you an editor.
          </p>
        )}
        <div className="space-y-2">
          {CAPS.map(cap => (
            <label
              key={cap.key}
              className={`flex items-start gap-2.5 group ${canWrite ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
              <input
                type="checkbox"
                checked={value[cap.key]}
                disabled={!canWrite}
                onChange={e => set({ [cap.key]: e.target.checked })}
                className={`mt-0.5 w-4 h-4 rounded accent-brand-600 ${canWrite ? 'cursor-pointer' : 'cursor-not-allowed'}`}
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
          className="w-full p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
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
            className="w-full mt-2 p-2.5 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-xl text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
          />
        )}
      </div>
    </div>
  );
}
