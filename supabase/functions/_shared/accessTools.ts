/**
 * SQEM-663 — the rules behind `set_access`, `set_editors` and the playbook `tag` over MCP and in Chat:
 * which rows a mode writes, and the sentence the model reads back. Import-free on purpose, like
 * `libraryToolDefs.ts`: the handlers (`libraryActions.ts`) pull in npm:/jsr: specifiers vitest cannot
 * load, and these rules are what the tests must pin.
 *
 * The three access states are the app's (SQEM-210): **no rows** = everyone in the workspace · **one
 * row naming nobody** = only the owner · **rows naming people or groups** = restricted to those.
 * The editor list (SQEM-473): **no rows** = anyone who may edit at all · **rows** = only those named
 * (the owner and admins keep their right regardless).
 */

export type AccessMode = 'everyone' | 'only_me' | 'restricted';
export type EditorsMode = 'anyone' | 'selected';

export interface Principals {
  userIds: string[];
  groupIds: string[];
}

/** Ids as the model passes them: strings only, trimmed, no duplicates, bounded. */
export function idList(v: unknown, max = 100): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean))].slice(0, max);
}

export type AccessPlan =
  | { ok: true; rows: Array<{ user_id?: string; group_id?: string }> }
  | { ok: false; message: string };

/**
 * The rows one access mode writes (after deleting the old ones). `everyone` writes none, `only_me`
 * the principal-less marker, `restricted` one row per person or group.
 */
export function accessPlan(mode: unknown, who: Principals, hasOwner: boolean): AccessPlan {
  if (mode === 'everyone') return { ok: true, rows: [] };
  if (mode === 'only_me') {
    // ⛔ A principal-less row over an object without an owner is invisible to EVERYONE and only
    // recoverable by SQL (SQEM-240). Never write one.
    if (!hasOwner) return { ok: false, message: 'This has no owner any more, so "only me" would hide it from everyone. Restrict it to named people instead.' };
    return { ok: true, rows: [{}] };
  }
  if (mode === 'restricted') {
    if (!who.userIds.length && !who.groupIds.length)
      return { ok: false, message: 'mode "restricted" needs at least one person (user_ids) or group (group_ids) — use list_members to find them, or mode "only_me".' };
    return { ok: true, rows: [...who.userIds.map(user_id => ({ user_id })), ...who.groupIds.map(group_id => ({ group_id }))] };
  }
  return { ok: false, message: 'mode must be one of: everyone, only_me, restricted' };
}

export type EditorsPlan =
  | { ok: true; rows: Array<{ user_id?: string; group_id?: string }> }
  | { ok: false; message: string };

export function editorsPlan(mode: unknown, who: Principals): EditorsPlan {
  if (mode === 'anyone') return { ok: true, rows: [] };
  if (mode === 'selected') {
    if (!who.userIds.length && !who.groupIds.length)
      return { ok: false, message: 'mode "selected" needs at least one person (user_ids) or group (group_ids) — use list_members to find them.' };
    return { ok: true, rows: [...who.userIds.map(user_id => ({ user_id })), ...who.groupIds.map(group_id => ({ group_id }))] };
  }
  return { ok: false, message: 'mode must be one of: anyone, selected' };
}

/** Ids that are not members / groups of this workspace — refused by name, never silently dropped. */
export function unknownIds(who: Principals, memberIds: Set<string>, groupIds: Set<string>): string[] {
  return [...who.userIds.filter(id => !memberIds.has(id)), ...who.groupIds.filter(id => !groupIds.has(id))];
}

const list = (names: string[]) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** What the model reads back: the new state in words, so it can tell the person. */
export function accessSentence(what: 'playbook' | 'persona', mode: AccessMode, names: string[], caller: { isOwner: boolean; keepsSight: boolean }): string {
  if (mode === 'everyone') return `Everyone in the workspace can now see this ${what}.`;
  // The owner always keeps sight (`mcp_accessible_template_ids`: `created_by = user` comes first).
  const lost = caller.keepsSight ? '' : ' You are not among them, so you will no longer see it.';
  if (mode === 'only_me') return caller.isOwner ? `Only you can now see this ${what}.` : `Only its owner can now see this ${what}.${lost}`;
  return `Only ${list(names)} can now see this ${what}, and its owner.${lost}`;
}

export function editorsSentence(what: 'playbook' | 'persona', mode: EditorsMode, names: string[]): string {
  if (mode === 'anyone') return `Anyone who may edit in this workspace can now change this ${what}.`;
  return `Only ${list(names)} can now change this ${what}, besides its owner and the workspace admins.`;
}

/** A playbook carries ONE tag in the app (`prompts.tags[0]`). Trimmed and bounded; '' removes it. */
export const MAX_TAG_LENGTH = 40;
export function normalizeTag(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;        // not passed: unchanged
  if (v === null) return null;                  // removed
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, MAX_TAG_LENGTH);
  return t ? t : null;
}
