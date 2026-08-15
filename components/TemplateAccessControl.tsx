// SQEM-142 Phase 2 — template access control. SQEM-143 v2 — per-user rows.
// Used in the template editor (per template) and Settings → General (the workspace default).
//
// SQEM-210/212 — three states, and the difference between two of them is a row, not a list:
//   everyone    no rows at all
//   private     one row naming nobody  ("Only me" — the creator, and nobody else at all)
//   restricted  one row per named principal (plus admins, editors, the creator)
// The asymmetry is deliberate: "Restrict access" picks a subset of the team and the people who run
// the workspace come along; "Only me" is a promise to one person and admits no exceptions.
//
// SQEM-211 — **per template, access is granted to people, not to roles.** The role checkbox is
// gone; "Restrict access" lists the members and starts with none of them ticked. Admins and editors
// are not listed at all: `can_access_template` grants them regardless, so a tick would do nothing.
//
// The trade this makes, and the reason the control says so out loud: a role grant is *dynamic*
// (whoever is a member next month is covered), a list of names is *static*. Restricting a template
// no longer follows the team as it grows — which fails quietly, so the note under the list is part
// of the decision, not decoration.
import { useMemo, useState } from 'react';
import type { UserRole, User } from '../types';
import { Users, Lock, Search, UserRound } from 'lucide-react';

export type TemplateAccessMode = 'everyone' | 'private' | 'restricted';
export type TemplateAccessValue = { mode: TemplateAccessMode; userIds: string[] };

/**
 * The workspace default (SQEM-211) is two states, not a set of roles: new templates are open, or
 * they start restricted and the creator picks people per template.
 *
 * The column stays `workspace_role[]` — **empty means open, non-empty means restricted** — so no
 * migration is needed. The stored `['member']` therefore no longer reads as "members may"; it is
 * simply the non-empty marker. Anything that interprets the roles in this column as grantees is
 * wrong since SQEM-211.
 */
export function workspaceDefaultToValue(roles: UserRole[]): TemplateAccessValue {
  return roles.length ? { mode: 'restricted', userIds: [] } : { mode: 'everyone', userIds: [] };
}
/** The control's value → what to persist as the workspace default. */
export function valueToWorkspaceDefault(v: TemplateAccessValue): UserRole[] {
  return v.mode === 'everyone' ? [] : ['member'];
}
/**
 * The workspace default → the starting value of a *new* template.
 *
 * "Restricted by default" seeds **Only me**, because that is what the template actually is at that
 * moment: nobody else has been picked yet. Seeding a role row instead — which is what happened
 * before SQEM-211 — planted a state the editor could no longer show or write.
 */
export function seedFromWorkspaceDefault(roles: UserRole[]): TemplateAccessValue {
  return roles.length ? { mode: 'private', userIds: [] } : { mode: 'everyone', userIds: [] };
}

/**
 * The DB rows → the control's value.
 *
 * `hasRules` carries the distinction the empty lists cannot (SQEM-210): no rows = everyone, a row
 * naming nobody = only me. They are opposites, so reading them from the lists alone is impossible.
 *
 * **Role rows are resolved into the people they currently cover (SQEM-211).** `editor` rows are
 * simply dropped — editors are granted by the RLS function, so the row never mattered. A `member`
 * row expands into today's members, which preserves exactly what the template does *right now* and
 * makes the switch from dynamic to static visible in the list instead of hiding it. Nothing is
 * written until the template is saved, so an untouched template keeps its dynamic row.
 */
export function accessToValue(
  roles: UserRole[],
  userIds: string[],
  hasRules: boolean,
  members: User[] = [],
): TemplateAccessValue {
  if (!hasRules) return { mode: 'everyone', userIds: [] };
  const fromRole = roles.includes('member') ? members.filter(m => m.role === 'member').map(m => m.id) : [];
  const people = Array.from(new Set([...userIds, ...fromRole]));
  return people.length ? { mode: 'restricted', userIds: people } : { mode: 'private', userIds: [] };
}
/**
 * The control's value → what to persist (per template). **Never writes a role row** — that is the
 * whole point of SQEM-211. "Restricted" with nobody ticked is the same thing as "Only me" and
 * writes the same principal-less row; the control does not need to prevent it.
 */
export function accessValueToAccess(v: TemplateAccessValue): { roles: UserRole[]; userIds: string[]; hasRules: boolean } {
  if (v.mode === 'everyone') return { roles: [], userIds: [], hasRules: false };
  if (v.mode === 'private') return { roles: [], userIds: [], hasRules: true };
  return { roles: [], userIds: v.userIds, hasRules: true };
}

export function TemplateAccessControl({
  value,
  onChange,
  label = 'Access',
  hint = 'Who can see & use this template',
  members,
  allowPrivate = false,
}: {
  value: TemplateAccessValue;
  onChange: (v: TemplateAccessValue) => void;
  label?: string;
  hint?: string;
  /** The people who can be granted access. Provided by the template editor; omitted for the
   *  workspace default, which only decides *whether* new templates start restricted. */
  members?: User[];
  /** SQEM-210 — offer "Only me". Per template only: as a workspace *default* it would mean every
   *  new template starts invisible to the team, which is not a default anyone wants. */
  allowPrivate?: boolean;
}) {
  const [memberSearch, setMemberSearch] = useState('');

  const setMode = (mode: TemplateAccessMode) => {
    if (mode === value.mode) return;
    // SQEM-211 — "Restrict access" starts with nobody ticked: it asks rather than assuming. That
    // state is identical to "Only me" (same principal-less row), which is fine — "Only me" stays
    // as the one-click version that explains itself.
    onChange(mode === 'restricted' ? { mode, userIds: value.userIds } : { mode, userIds: [] });
  };
  const toggleUser = (userId: string) => {
    const has = value.userIds.includes(userId);
    onChange({ ...value, mode: 'restricted', userIds: has ? value.userIds.filter(u => u !== userId) : [...value.userIds, userId] });
  };

  const optionClass = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm text-left transition-all ${
      active
        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-slate-900 dark:text-slate-100'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
    }`;

  // SQEM-211 — admins AND editors are out: `can_access_template` grants both regardless, so a tick
  // beside their name would change nothing while implying it did. What remains is the set of people
  // a restriction can actually distinguish between.
  const grantableMembers = useMemo(() => (members ?? []).filter(m => m.role === 'member'), [members]);
  // With nobody to grant — the normal state of a fresh workspace, where you are alone and an admin —
  // "Restrict access" could only produce the state "Only me" already covers. A control that cannot
  // do anything is a dead control (cf. the disabled billing buttons removed in SQEM-207).
  const canRestrict = !members || grantableMembers.length > 0;
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
        {allowPrivate && (
          <button type="button" onClick={() => setMode('private')} className={optionClass(value.mode === 'private')}>
            <UserRound className="w-4 h-4 shrink-0" />
            <span>
              <span className="font-semibold">Only me</span>
              {/* SQEM-212 — this used to read "admins & editors aside", which was the truth about
                  the RLS function rather than a promise anyone wanted. The function changed; so
                  does the sentence. If it ever says "only" again, check `can_access_template`. */}
              <span className="block text-xs text-slate-400">Nobody else — not admins, not editors</span>
            </span>
          </button>
        )}
        {canRestrict && (
          <button type="button" onClick={() => setMode('restricted')} className={optionClass(value.mode === 'restricted')}>
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              <span className="font-semibold">{members ? 'Restrict access' : 'Restricted by default'}</span>
              <span className="block text-xs text-slate-400">
                {members
                  ? 'Pick the people who can use it'
                  : 'New templates start restricted — choose who can use each one in the template itself'}
              </span>
            </span>
          </button>
        )}
      </div>
      {value.mode === 'restricted' && (
        <div className="mt-3 pl-1 space-y-2">
          {grantableMembers.length > 0 && (
            <div>
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

          {/* SQEM-211 — the trade this control makes, stated where the decision is made. A role
              grant covered whoever joined later; a list of names does not, and that failure is
              silent: someone joins, cannot see the template, and nobody knows why. */}
          <p className="text-2xs text-slate-400 dark:text-slate-500 pt-1">
            Access is per person — people who join later don&apos;t get it automatically.
            Admins, editors &amp; the creator always have access.
          </p>
        </div>
      )}
    </div>
  );
}
