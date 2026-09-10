import { supabase } from '../supabase';
import type { UserRole } from '../../types';

export async function removeMember(workspaceId: string, userId: string) {
  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) throw error;
}

export async function updateMemberRole(workspaceId: string, userId: string, role: UserRole) {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);

  if (error) throw error;
}

/**
 * SQEM-343 — what a demotion to `member` would strand.
 *
 * Templates and personas this person created that carry access rules. Once they are a member, the
 * write policies require visibility (SQEM-341) — and a restricted object is visible to its creator
 * and to nobody else, so it would become editable by nobody at all.
 *
 * ⚠️ Files are deliberately not counted. The workspace file library has no "only me" state, so no
 * dead end arises there — they do move custody on a handover, and the UI says so.
 */
export async function countRestrictedContentForMember(
  workspaceId: string,
  userId: string,
): Promise<{ templates: number; personas: number }> {
  const { data, error } = await supabase.rpc('count_restricted_content_for_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { templates?: number; personas?: number } | null;
  return { templates: row?.templates ?? 0, personas: row?.personas ?? 0 };
}

/**
 * SQEM-343 — hand this person's content to the longest-standing remaining admin.
 *
 * ⛔ Goes through `handover_content_from_member`, never `reassign_orphaned_content` directly: the
 * latter has no permission check because its two triggers call it with no `auth.uid()`, and its
 * execute grant was revoked in the SQEM-341/343 migration for exactly that reason.
 */
export async function handoverContentFromMember(workspaceId: string, userId: string) {
  const { error } = await supabase.rpc('handover_content_from_member', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/**
 * SQEM-343 — drop the "only me" marker from this person's templates and personas.
 *
 * ⚠️ Named principals survive: an object that also names people stays restricted to those people.
 * Only where the principal-less row was the sole rule does the object become workspace-visible.
 */
export async function releaseRestrictedContent(
  workspaceId: string,
  userId: string,
): Promise<{ templates: number; personas: number }> {
  const { data, error } = await supabase.rpc('release_restricted_content', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { templates?: number; personas?: number } | null;
  return { templates: row?.templates ?? 0, personas: row?.personas ?? 0 };
}
