// SQEM-142 Phase 2 — template access control. SQEM-143 v2 — per-user rows.
// Used in the template editor (per template) and Settings → General (the workspace default).
//
// SQEM-210/212 — three states, and the difference between two of them is a row, not a list:
//   everyone    no rows at all
//   private     one row naming nobody  ("Only me" — the creator, and nobody else at all)
//   restricted  one row per named principal — a person or a group — plus the creator
//
// SQEM-292 — **admins and editors no longer come along.** "Restrict access" used to mean "these
// people, and also everyone who runs the workspace", which is not what it said. Both states are now
// promises: "Only me" to one person, "Restrict access" to a named set. Emergency access is
// `reassign_orphaned_templates()` — it hands a departing member's templates to the longest-standing
// admin, which is an event rather than a standing permission.
//
// SQEM-211 — **per template, access is granted to people, not to roles.** The role checkbox is gone.
//
// SQEM-292 — and to **groups**, which is the answer to the trade SQEM-211 had to make. A role grant
// was *dynamic* (whoever is a member next month is covered); a list of names is *static*, so
// restricting a template stopped following the team as it grew. A group is static per template and
// dynamic per person: add somebody to Marketing once, and every template Marketing reaches follows.
// That is why the group tab comes first — it is the option that keeps working.
import { useMemo, useState } from 'react';
import type { UserRole, User } from '../types';
import { Users, Lock, Search, UserRound, AlertTriangle } from 'lucide-react';
import Checkbox from './ui/Checkbox';

export type TemplateAccessMode = 'everyone' | 'private' | 'restricted';
export type TemplateAccessValue = { mode: TemplateAccessMode; userIds: string[]; groupIds?: string[] };

/**
 * The workspace default (SQEM-211) is two states, not a set of roles: new templates are open, or
 * they start restricted and the creator picks people per template.
 *
 * The column stays `workspace_role[]` — **empty means open, non-empty means restricted** — so no
 * migration is needed. The stored `['member']` therefore no longer reads as "members may"; it is
 * simply the non-empty marker. Anything that interprets the roles in this column as grantees is
 * wrong since SQEM-211.
 */
/**
 * The workspace default → what the setting shows.
 *
 * ⛔ **`restricted` (SQEM-319), and the history matters because the previous answer was not wrong so
 * much as half-applied.** SQEM-292 changed this to `private` for a sound reason: the setting used to
 * say "Restrict access" while `seedFromWorkspaceDefault` created **Only me**, and once admins and
 * editors lost automatic access, "restricted with nobody picked" would have meant *nobody at all*
 * while promising a selection.
 *
 * ⚠️ **But no `private` button is rendered here.** Settings deliberately omits `allowPrivate`
 * (SQEM-210: "Only me" as a workspace-wide default would start every new template invisible to the
 * team). So the value matched no visible option and **nothing lit up** — the owner reported the
 * setting as broken while it was saving correctly all along. *Two names for one behaviour became no
 * name at all*, which is strictly worse than what SQEM-292 set out to fix.
 *
 * **The resolution is not to undo SQEM-292 but to separate two things it treated as one.** The
 * *default* and the *template* are different objects at different moments: the setting says how new
 * templates **start**, the editor says what a template **is right now**. The button in this context
 * is already labelled *"Restricted by default"* — the words were right, only the value disagreed.
 *
 * ⚠️ `seedFromWorkspaceDefault` below still returns `private`, and is still correct there: a
 * template at the moment of creation genuinely is "only me", because nobody has been picked yet.
 */
export function workspaceDefaultToValue(roles: UserRole[]): TemplateAccessValue {
  return roles.length
    ? { mode: 'restricted', userIds: [], groupIds: [] }
    : { mode: 'everyone', userIds: [], groupIds: [] };
}
/** The control's value → what to persist as the workspace default. */
export function valueToWorkspaceDefault(v: TemplateAccessValue): UserRole[] {
  return v.mode === 'everyone' ? [] : ['member'];
}
/**
 * The workspace default → the starting value of a *new* template.
 *
 * Seeds **Only me**, because that is what the template actually is at that moment: nobody else has
 * been picked yet. Seeding a role row instead — which is what happened before SQEM-211 — planted a
 * state the editor could no longer show or write.
 *
 * Since SQEM-292 the setting above says the same word, so the two finally agree.
 */
export function seedFromWorkspaceDefault(roles: UserRole[]): TemplateAccessValue {
  return roles.length
    ? { mode: 'private', userIds: [], groupIds: [] }
    : { mode: 'everyone', userIds: [], groupIds: [] };
}

/**
 * The DB rows → the control's value.
 *
 * `hasRules` carries the distinction the empty lists cannot (SQEM-210): no rows = everyone, a row
 * naming nobody = only me. They are opposites, so reading them from the lists alone is impossible.
 *
 * **Role rows are resolved into the people they currently cover (SQEM-211).** A `member` row expands
 * into today's members, which preserves exactly what the template does *right now* and makes the
 * switch from dynamic to static visible in the list instead of hiding it. Nothing is written until
 * the template is saved, so an untouched template keeps its dynamic row.
 *
 * **SQEM-238 — a rule that resolves to nobody is `restricted`, never `private`.** This function used
 * to drop `editor`/`admin` rows on the grounds that `can_access_template` grants those roles anyway,
 * "so the row never mattered". It mattered here: with the row dropped, `people` came out empty and
 * empty meant `private` — so a template that literally grants **every editor** was displayed as
 * *"Only me — nobody else, not admins, not editors"*. Measured on production 2026-08-17: one
 * `role='editor'` row from the SQEM-142 era, shown as Only me, visible to a second account.
 *
 * Both of the old answers were wrong, in opposite directions — reading it as `everyone` would have
 * opened it to members, reading it as `private` claimed a promise that was not being kept. The
 * honest answer is `restricted`: a restriction exists, nobody is named individually, and admins,
 * editors and the creator have access — which is exactly what the footer of this control says.
 */
export function accessToValue(
  roles: UserRole[],
  userIds: string[],
  hasRules: boolean,
  members: User[] = [],
  groupIds: string[] = [],
): TemplateAccessValue {
  if (!hasRules) return { mode: 'everyone', userIds: [], groupIds: [] };
  const fromRole = roles.includes('member') ? members.filter(m => m.role === 'member').map(m => m.id) : [];
  const people = Array.from(new Set([...userIds, ...fromRole]));
  if (people.length || groupIds.length) return { mode: 'restricted', userIds: people, groupIds };
  // Rows exist but name nobody this control can list. Only the principal-less row (no roles, no
  // users, no groups) actually means "only me"; anything else is a rule we cannot express, and
  // calling that "Only me" is the lie SQEM-238 fixes.
  return roles.length
    ? { mode: 'restricted', userIds: [], groupIds: [] }
    : { mode: 'private', userIds: [], groupIds: [] };
}

/**
 * SQEM-238 — the role rows this control cannot represent, so the editor can say so out loud.
 *
 * A `member` row is fine: `accessToValue` turns it into the people it covers, and the user sees
 * exactly who that is. `editor` and `admin` rows have no such rendering — they resolve to nobody,
 * because admins and editors are never listed (SQEM-211: ticking them would change nothing).
 *
 * The template therefore displays as "Restrict access" with an empty list, which is true but
 * incomplete — and **saving that state writes the principal-less row**, which since SQEM-212 means
 * the creator alone. Narrowing a template is a decision, not a side effect of pressing Save, so the
 * control warns instead of quietly converting.
 */
export function unrepresentableRoleGrants(roles: UserRole[]): UserRole[] {
  return roles.filter(r => r !== 'member');
}
/**
 * The control's value → what to persist (per template). **Never writes a role row** — that is the
 * whole point of SQEM-211. "Restricted" with nobody ticked is the same thing as "Only me" and
 * writes the same principal-less row; the control does not need to prevent it.
 */
export function accessValueToAccess(
  v: TemplateAccessValue,
  ownerId?: string | null,
): { roles: UserRole[]; userIds: string[]; groupIds: string[]; hasRules: boolean } {
  if (v.mode === 'everyone') return { roles: [], userIds: [], groupIds: [], hasRules: false };
  if (v.mode === 'private') return { roles: [], userIds: [], groupIds: [], hasRules: true };
  // SQEM-300 — never persist a row for the owner. `can_access_template` tests
  // `created_by = auth.uid()` first and unconditionally, so such a row grants nothing that is not
  // already true, and a row that grants nothing is a row somebody will later try to reason about.
  // Stripping it on the way out also clears any that were written before this rule existed.
  //
  // ⛔ **`ownerId` null strips nobody, and that is the correct answer rather than a fallback.**
  // With no `created_by` the creator branch matches nobody (SQEM-240), so nobody holds implicit
  // access and every name in the list is doing real work.
  return {
    roles: [],
    userIds: ownerId ? v.userIds.filter(id => id !== ownerId) : v.userIds,
    groupIds: v.groupIds ?? [],
    hasRules: true,
  };
}

export function TemplateAccessControl({
  value,
  onChange,
  label = 'Access',
  hint = 'Who can see & use this template',
  members,
  groups,
  onCreateGroup,
  allowPrivate = false,
  legacyRoles = [],
  privateDisabledReason,
  ownerId,
  multiSeat = false,
}: {
  value: TemplateAccessValue;
  onChange: (v: TemplateAccessValue) => void;
  label?: string;
  hint?: string;
  /** The people who can be granted access. Provided by the template editor; omitted for the
   *  workspace default, which only decides *whether* new templates start restricted. */
  members?: User[];
  /** SQEM-292 — the workspace's access groups. Omitted for the workspace default, which cannot
   *  collect a selection for templates that do not exist yet. */
  groups?: { id: string; name: string; memberIds: string[] }[];
  /** Opens group management. Only passed when the viewer may create groups (admins) — an editor
   *  gets the tab and the picker, but no dead "create" button that RLS would reject. */
  onCreateGroup?: () => void;
  /** SQEM-210 — offer "Only me". Per template only: as a workspace *default* it would mean every
   *  new template starts invisible to the team, which is not a default anyone wants. */
  allowPrivate?: boolean;
  /** SQEM-238 — role grants stored on this template that the list cannot show (see
   *  `unrepresentableRoleGrants`). Rendered as a warning, because saving replaces them. */
  legacyRoles?: UserRole[];
  /** SQEM-240 — why "Only me" cannot be picked here. Set when the template has no owner:
   *  `can_access_template` matches the creator by id, and NULL matches nobody, so the choice would
   *  hide the template from everyone including the person making it. Shown, not hidden — a control
   *  that silently lacks an option teaches nothing. */
  privateDisabledReason?: string;
  /** SQEM-300 — the template's owner, left out of the people list because they hold access
   *  unconditionally: offering the tick implies it could be *un*ticked, which is the one thing it
   *  cannot do. The owner is still shown, just as the owner (SQEM-241), not as a choice.
   *
   *  ⚠️ **This is the owner, not the viewer.** They are the same person while creating a template
   *  and need not be while editing one; filtering on the viewer would hide the wrong row and leave
   *  the real owner tickable — the same defect, harder to see. Null lists everybody. */
  ownerId?: string | null;
  /** SQEM-314 — the workspace can hold more than one person (Team/Business, or managed). Offers
   *  "Restrict access" even while nobody else is there yet: on a multi-seat plan the absence of
   *  colleagues is a matter of time, not a reason to withhold the control. */
  multiSeat?: boolean;
}) {
  const [memberSearch, setMemberSearch] = useState('');

  const setMode = (mode: TemplateAccessMode) => {
    if (mode === value.mode) return;
    // SQEM-211 — "Restrict access" starts with nobody ticked: it asks rather than assuming. That
    // state is identical to "Only me" (same principal-less row), which is fine — "Only me" stays
    // as the one-click version that explains itself.
    onChange(mode === 'restricted' ? { mode, userIds: selectedUserIds } : { mode, userIds: [] });
  };
  const toggleUser = (userId: string) => {
    const has = selectedUserIds.includes(userId);
    onChange({ ...value, mode: 'restricted', userIds: has ? selectedUserIds.filter(u => u !== userId) : [...selectedUserIds, userId] });
  };

  const optionClass = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm text-left transition-all ${
      active
        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-slate-900 dark:text-slate-100'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
    }`;

  // ⚠️ SQEM-292 — **admins and editors are back in this list, and leaving them out would now be a
  // bug.** SQEM-211 filtered them away with a sound reason at the time: `can_access_template()`
  // granted them regardless, so a tick beside their name changed nothing while implying it did. That
  // reason is gone — they have no automatic access any more, so omitting them would make it
  // impossible to grant an admin access to a restricted template at all.
  // SQEM-292 — everyone in the workspace, not only members: with the automatic admin/editor grant
  // gone, an admin has to be nameable like anyone else.
  // SQEM-300 — minus the owner, who cannot be granted what they already have.
  const grantableMembers = useMemo(
    () => (members ?? []).filter(m => !ownerId || m.id !== ownerId),
    [members, ownerId],
  );
  // What the control shows as chosen. Derived rather than read straight off `value`, so a row
  // written before SQEM-300 cannot make the counter disagree with the ticks below it — there would
  // be no member left to render for it.
  //
  // ⚠️ Deliberately not `useMemo`: a conditional that returns `value.userIds` unchanged on one
  // branch is memoization the React Compiler cannot preserve, and it fails the lint as an error
  // rather than a warning. An unconditional filter over a handful of ids is cheaper than the hand-
  // written cache would have been, and the compiler memoizes it itself.
  const selectedUserIds = value.userIds.filter(id => id !== ownerId);
  // SQEM-292 — groups first: it is the option that keeps working as the team changes, and the one a
  // workspace should reach for by default. People stays one click away for the genuine exceptions.
  const [tab, setTab] = useState<'groups' | 'people'>(
    (value.groupIds?.length ?? 0) > 0 || (groups?.length ?? 0) > 0 ? 'groups' : 'people',
  );
  const selectedGroupIds = value.groupIds ?? [];
  const toggleGroup = (groupId: string) => {
    const has = selectedGroupIds.includes(groupId);
    onChange({
      ...value,
      mode: 'restricted',
      userIds: selectedUserIds,
      groupIds: has ? selectedGroupIds.filter(g => g !== groupId) : [...selectedGroupIds, groupId],
    });
  };
  // With nobody to grant — the normal state of a fresh workspace, where you are alone and an admin —
  // "Restrict access" could only produce the state "Only me" already covers. Groups count too: a
  // workspace with groups but one person can still restrict to a group meaningfully later.
  //
  // ⛔ **SQEM-314 — `multiSeat` overrides all of that, and it is the whole bug report.** Switching
  // Solo → Team left this button hidden, because a plan change moves the *seat allowance* and not
  // the member count: still alone, still nothing to grant, still no button. Somebody who has just
  // paid for a multi-person plan is told nothing changed.
  //
  // On a multi-seat workspace the option belongs here **before** the people arrive — and there is
  // something to do with it immediately, because an admin is offered "create your first group"
  // right below. The redundancy argument above only holds where more people are impossible.
  const canRestrict = !members || multiSeat || grantableMembers.length > 0 || (groups?.length ?? 0) > 0;
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return grantableMembers;
    return grantableMembers.filter(m => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [grantableMembers, memberSearch]);

  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</label>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">{hint}</p>
      {/* SQEM-238 — an old role grant this control cannot list. Saying nothing is what produced the
          bug: the template read as "Only me" while every editor could open it. The warning names
          the stored rule and what Save will do with it, so replacing it is a choice. */}
      {legacyRoles.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            This template carries an older rule granting{' '}
            <span className="font-semibold">{legacyRoles.join(' & ')}s</span> as a group, which this
            list cannot show — it grants roles, not people.{' '}
            <span className="font-semibold">Saving replaces it with your selection below.</span>
          </p>
        </div>
      )}
      <div className="space-y-2">
        <button type="button" onClick={() => setMode('everyone')} className={optionClass(value.mode === 'everyone')}>
          <Users className="w-4 h-4 shrink-0" />
          <span>
            <span className="font-semibold">Everyone</span>
            <span className="block text-xs text-slate-400">All workspace members can use it</span>
          </span>
        </button>
        {allowPrivate && (
          <button
            type="button"
            onClick={() => { if (!privateDisabledReason) setMode('private'); }}
            disabled={!!privateDisabledReason}
            title={privateDisabledReason}
            className={`${optionClass(value.mode === 'private')} ${privateDisabledReason ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <UserRound className="w-4 h-4 shrink-0" />
            <span>
              <span className="font-semibold">Only me</span>
              {/* SQEM-212 — this used to read "admins & editors aside", which was the truth about
                  the RLS function rather than a promise anyone wanted. The function changed; so
                  does the sentence. If it ever says "only" again, check `can_access_template`.
                  SQEM-240 — when the template has no owner the option states why it is unavailable
                  instead of quietly vanishing. */}
              <span className="block text-xs text-slate-400">
                {privateDisabledReason || 'Nobody else — not admins, not editors'}
              </span>
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
          {/* SQEM-292 — the tab only appears where there is something to choose between. In the
              workspace default there are no groups and no members, and a switcher over two empty
              lists is furniture. */}
          {groups && (
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 mb-1">
              {(['groups', 'people'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    tab === t
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {t === 'groups' ? 'Groups' : 'People'}
                  {t === 'groups' && selectedGroupIds.length > 0 && ` (${selectedGroupIds.length})`}
                  {t === 'people' && selectedUserIds.length > 0 && ` (${selectedUserIds.length})`}
                </button>
              ))}
            </div>
          )}

          {groups && tab === 'groups' && (
            <div>
              {groups.length === 0 ? (
                /* ⚠️ Not an empty box. Somebody who picked "Restrict access" wants to restrict it —
                   telling them there is nothing here leaves them stuck at the moment they decided to
                   act. The button is absent for editors, who cannot create groups (RLS), so they get
                   the reason instead of a control that fails. */
                <div className="text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4 text-center">
                  <p className="font-semibold text-slate-600 dark:text-slate-300">No groups yet</p>
                  <p className="mt-1">A group keeps working as the team changes — add someone once, and every template that group reaches follows.</p>
                  {onCreateGroup ? (
                    <button type="button" onClick={onCreateGroup} className="mt-2 text-brand-600 dark:text-brand-400 font-semibold hover:underline">
                      Create your first group →
                    </button>
                  ) : (
                    <p className="mt-2 text-slate-400">Ask a workspace admin to create one, or pick people instead.</p>
                  )}
                </div>
              ) : (
                /* Deliberately identical to the people list below — same row height, same checkbox,
                   same secondary line. Two pickers that sit behind one switcher and look different
                   read as two features. */
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {groups.map(g => (
                    <label key={g.id} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                      <Checkbox checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                      <span className="min-w-0">
                        <span className="font-medium">{g.name}</span>
                        {/* The member count is the difference between picking a name and knowing what
                            it does. An empty group grants nothing, and that is worth seeing before
                            saving rather than after somebody reports missing access. */}
                        <span className="block text-2xs text-slate-400 truncate">
                          {g.memberIds.length === 0 ? 'No members — grants nobody access' : `${g.memberIds.length} ${g.memberIds.length === 1 ? 'person' : 'people'}`}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {(!groups || tab === 'people') && grantableMembers.length > 0 && (
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
                    <Checkbox checked={selectedUserIds.includes(m.id)} onChange={() => toggleUser(m.id)} />
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

          {/* SQEM-211 — the trade this control makes, stated where the decision is made. A list of
              names does not cover whoever joins later, and that failure is silent: someone joins,
              cannot see the template, and nobody knows why. Groups exist to answer exactly that,
              which is why the sentence now names both and says which one follows the team.

              ⚠️ SQEM-300 — this line said "Admins, editors & the creator always have access" until
              2026-08-31, one day after SQEM-292 stopped that being true. It shipped to production
              and into self-host v1.11.3 saying the opposite of what the database does — the worst
              kind of stale copy, because it describes access and a reader has no way to check it.
              **A sentence about who can see something has to be re-read whenever the rule changes,
              not only when the sentence changes.**

              SQEM-238 — the wording stays conditional, because with nobody named it would not be
              true. "Restricted, nobody named" is stored as the principal-less row and means the
              creator alone. ⛔ The condition now counts **groups as well**: a template with a group
              and no individuals was being described as "the same as Only me", which is exactly the
              untruth this comment was written about. */}
          <p className="text-2xs text-slate-400 dark:text-slate-500 pt-1">
            {selectedUserIds.length > 0 || selectedGroupIds.length > 0
              ? 'Only the people and groups named here, plus whoever created the template. Naming a person is per person — somebody who joins later does not get it automatically; a group does follow the team.'
              : 'Nobody is named yet, so this is the same as Only me — the creator alone.'}
          </p>
        </div>
      )}
    </div>
  );
}
