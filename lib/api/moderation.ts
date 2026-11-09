// SQEM-666 — moderation: the moderators of a workspace, the review state of playbooks and personas,
// submitting and deciding. The rules live in the database (see lib/moderation.ts for the states).
import { supabase } from '../supabase';
import type { ChangePayload, PendingChange, ReviewInfo, ReviewKind, ReviewState } from '../moderation';

// Not in the generated database.types yet; a thin cast keeps call sites typed (as lib/api/editors.ts).
type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as Client;

const TABLE: Record<ReviewKind, string> = { template: 'prompts', persona: 'personas' };

/** Ids of the workspace's moderators besides the admins. A read error yields none (admins still moderate). */
export async function fetchModeratorIds(workspaceId: string): Promise<string[]> {
  const { data, error } = await client.from('workspace_moderators').select('user_id').eq('workspace_id', workspaceId);
  if (error) return [];
  return ((data || []) as { user_id: string }[]).map(r => r.user_id);
}

/** Replace the moderator list (admins only, by RLS). Delete-then-insert like the editor lists. */
export async function setModerators(workspaceId: string, userIds: string[]): Promise<void> {
  const del = await client.from('workspace_moderators').delete().eq('workspace_id', workspaceId);
  if (del.error) throw del.error;
  if (!userIds.length) return;
  const ins = await client.from('workspace_moderators').insert(userIds.map(user_id => ({ workspace_id: workspaceId, user_id })));
  if (ins.error) throw ins.error;
}

/**
 * The review state of every playbook (or persona) of the workspace the caller can see that is not
 * released — one query per list. ⚠️ A separate query on purpose: the app goes live minutes before the
 * migration that adds the columns, and a list query naming a missing column would break the page.
 * A read error yields an empty map.
 */
export async function fetchReviewStates(kind: ReviewKind, workspaceId: string): Promise<Map<string, ReviewInfo>> {
  const { data, error } = await client.from(TABLE[kind]).select('id, review_state, review_note')
    .eq('workspace_id', workspaceId).not('review_state', 'is', null);
  if (error) return new Map();
  return new Map(((data || []) as { id: string; review_state: ReviewState; review_note: string | null }[])
    .map(r => [r.id, { state: r.review_state, note: r.review_note }]));
}

/** One object's state (the editor). Null = released, or the columns are not there yet. */
export async function fetchReviewState(kind: ReviewKind, id: string): Promise<ReviewInfo | null> {
  const { data, error } = await client.from(TABLE[kind]).select('review_state, review_note').eq('id', id).maybeSingle();
  if (error || !data || !data.review_state) return null;
  return { state: data.review_state as ReviewState, note: (data.review_note as string | null) ?? null };
}

/** The owner submits (or withdraws a submission). Returns the new state. */
export async function submitForReview(kind: ReviewKind, id: string, withdraw = false): Promise<ReviewState | null> {
  const { data, error } = await client.rpc('submit_for_review', { p_kind: kind, p_id: id, p_withdraw: withdraw });
  if (error) throw error;
  return (data as ReviewState | null) ?? null;
}

/** A moderator or admin releases or rejects (with a reason). */
export async function decideReview(kind: ReviewKind, id: string, release: boolean, note?: string): Promise<void> {
  const { error } = await client.rpc('decide_review', { p_kind: kind, p_id: id, p_release: release, p_note: note ?? null });
  if (error) throw error;
}

// ── SQEM-667 — pending changes ──────────────────────────────────────────────────────────────────────

type ChangeRow = {
  id: string; kind: ReviewKind; object_id: string; author: string; payload: ChangePayload; base_updated_at: string | null;
  state: 'pending' | 'rejected'; note: string | null; created_at: string; updated_at: string;
};
const toChange = (r: ChangeRow): PendingChange => ({
  id: r.id, kind: r.kind, objectId: r.object_id, author: r.author, payload: r.payload || {}, baseUpdatedAt: r.base_updated_at,
  state: r.state, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at,
});

/**
 * The pending changes the caller may see for one object (RLS: their own, or every one as a moderator).
 * An error (the table not there yet) yields none.
 */
export async function fetchPendingChanges(kind: ReviewKind, objectId: string): Promise<PendingChange[]> {
  const { data, error } = await client.from('pending_changes').select('*').eq('kind', kind).eq('object_id', objectId).order('created_at');
  if (error) return [];
  return ((data || []) as ChangeRow[]).map(toChange);
}

/** Every pending change the caller may see in the workspace (lists, Overview). An error yields none. */
export async function fetchWorkspacePendingChanges(workspaceId: string): Promise<PendingChange[]> {
  const { data, error } = await client.from('pending_changes').select('*').eq('workspace_id', workspaceId);
  if (error) return [];
  return ((data || []) as ChangeRow[]).map(toChange);
}

export async function submitChange(kind: ReviewKind, objectId: string, payload: ChangePayload, baseUpdatedAt: string | null): Promise<void> {
  const { error } = await client.rpc('submit_change', { p_kind: kind, p_id: objectId, p_payload: payload, p_base: baseUpdatedAt });
  if (error) throw error;
}

/** The author withdraws their own change. */
export async function withdrawChange(changeId: string): Promise<void> {
  const { error } = await client.from('pending_changes').delete().eq('id', changeId);
  if (error) throw error;
}

/** Thrown when the object changed after the submission and the release was not forced. */
export class ChangedSinceSubmitted extends Error {}

export async function decideChange(changeId: string, release: boolean, note?: string, force = false): Promise<void> {
  const { error } = await client.rpc('decide_change', { p_change_id: changeId, p_release: release, p_note: note ?? null, p_force: force });
  if (error) {
    if ((error as { code?: string }).code === '40001') throw new ChangedSinceSubmitted(error.message);
    throw error;
  }
}

// ── SQEM-669 — the review list ──────────────────────────────────────────────────────────────────────

export interface QueueItem {
  type: 'new' | 'change';
  kind: ReviewKind;
  id: string;
  /** prompt / skill / persona */
  subkind: string;
  title: string | null;
  author: string | null;
  submittedAt: string;
  changeId: string | null;
  payload: ChangePayload | null;
  baseUpdatedAt: string | null;
  /** Whether the caller can open the object in its editor (a moderator may review without access). */
  canOpen: boolean;
}

/** Everything waiting for review in the workspace (moderators and admins). An error yields none. */
export async function fetchReviewQueue(workspaceId: string, limit = 50, offset = 0): Promise<QueueItem[]> {
  const { data, error } = await client.rpc('review_queue', { p_workspace_id: workspaceId, p_limit: limit, p_offset: offset });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    type: r.type as 'new' | 'change', kind: r.kind as ReviewKind, id: r.id as string, subkind: (r.subkind as string) ?? '',
    title: (r.title as string | null) ?? null, author: (r.author as string | null) ?? null, submittedAt: r.submitted_at as string,
    changeId: (r.change_id as string | null) ?? null, payload: (r.payload as ChangePayload | null) ?? null,
    baseUpdatedAt: (r.base_updated_at as string | null) ?? null, canOpen: r.can_open === true,
  }));
}

/** The released state a waiting change is compared with — also for a moderator without access to the object. */
export async function fetchReleasedState(changeId: string): Promise<ChangePayload | null> {
  const { data, error } = await client.rpc('pending_change_released_state', { p_change_id: changeId });
  if (error || !data) return null;
  return data as ChangePayload;
}
