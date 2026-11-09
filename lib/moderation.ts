// SQEM-666 — moderation of new playbooks and personas: the rules the app shows, kept pure so the tests
// load them without Supabase. The database decides (`guard_review_state`, the access functions,
// `submit_for_review`, `decide_review`); this module only mirrors it so the screens say the truth.
//
// States: 'draft' (only the owner sees it) · 'pending' (submitted: owner, moderators, admins) ·
// 'rejected' (owner only, with a reason) · null = released, the chosen access applies.

export type ReviewState = 'draft' | 'pending' | 'rejected';
export type ReviewKind = 'template' | 'persona';

export interface ReviewInfo {
  state: ReviewState;
  note: string | null;
}

/** Admins always moderate; editors when listed. Members never (the database removes a demoted one). */
export function isModerator(role: string | null | undefined, userId: string, moderatorIds: ReadonlySet<string> | readonly string[]): boolean {
  if (role === 'admin') return true;
  if (role !== 'editor') return false;
  return Array.isArray(moderatorIds) ? moderatorIds.includes(userId) : (moderatorIds as ReadonlySet<string>).has(userId);
}

/** The people an admin may pick as moderators: editors and admins, never members. */
export function moderatorCandidates<T extends { role: string }>(members: readonly T[]): T[] {
  return members.filter(m => m.role === 'editor' || m.role === 'admin');
}

/**
 * Whether saving should also submit: the owner of something not yet released, who chose more than
 * "only me". "Only me" needs no review — it stays theirs alone.
 */
export function submitsOnSave(review: ReviewInfo | undefined, isOwner: boolean, accessMode: 'everyone' | 'private' | 'restricted'): boolean {
  if (!review || !isOwner) return false;
  return (review.state === 'draft' || review.state === 'rejected') && accessMode !== 'private';
}

/** What the list and preview show, by who is looking. A moderator sees "waiting" only on pending. */
export function reviewBadgeOf(review: ReviewInfo | undefined, isOwner: boolean, moderator: boolean): ReviewState | null {
  if (!review) return null;
  if (isOwner) return review.state;
  return moderator && review.state === 'pending' ? 'pending' : null;
}

// ── SQEM-667 — changes to shared playbooks and personas ────────────────────────────────────────────

/** A proposed change as stored: only the changed parts. Access rows as the database keeps them. */
export interface ChangePayload {
  title?: string;
  description?: string;
  content?: string;
  tag?: string | null;
  kind?: string;
  model?: string | null;
  variables?: unknown;
  context_file_ids?: string[];
  tags?: string[];
  connectors?: unknown;
  routes?: { template_id: string; condition: string }[];
  /** [] = everyone · [{}] = only the owner · rows naming people or groups = restricted. */
  access?: { user_id?: string; group_id?: string }[];
}

export interface PendingChange {
  id: string;
  kind: ReviewKind;
  objectId: string;
  author: string;
  payload: ChangePayload;
  baseUpdatedAt: string | null;
  state: 'pending' | 'rejected';
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a save goes to review instead of being written: the switch is on, the person does not
 * moderate, the object is released, and it is shared — or its access changes (a change of who may see
 * something released is always a change).
 */
export function changeNeedsReview(opts: {
  changesOn: boolean; moderator: boolean; released: boolean; shared: boolean; accessChanged: boolean;
}): boolean {
  return opts.changesOn && !opts.moderator && opts.released && (opts.shared || opts.accessChanged);
}

/** Only what differs from the released state goes into the payload (deep compare by JSON). */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = after[k];
  }
  return out;
}

/** The access control's value as access rows, the shape the database and the payload use. */
export function accessRowsOf(mode: 'everyone' | 'private' | 'restricted', userIds: string[], groupIds: string[]): { user_id?: string; group_id?: string }[] {
  if (mode === 'everyone') return [];
  if (mode === 'private') return [{}];
  return [...userIds.map(user_id => ({ user_id })), ...groupIds.map(group_id => ({ group_id }))];
}
