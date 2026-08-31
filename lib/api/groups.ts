// SQEM-292 — access groups.
//
// A group is a named set of people in a workspace, usable wherever a person can be named. It exists
// because "Restrict access" to a list of individuals is static: it does not follow the team. A group
// moves the maintenance to one place — add somebody to Marketing once, and every template Marketing
// can reach follows.
//
// ⚠️ **Membership is admin-only, by decision (2026-08-31).** Reading is open to the whole workspace,
// because the access dialog has to render names and an editor restricting a template needs to pick
// from them — a name grants nothing. Writing is not: an editor who could add themselves to a group
// would gain everything that group reaches, which makes the permission worth as much as the
// strongest group in the workspace. The RLS policies enforce this; these functions only mirror it.
import { supabase } from '../supabase';

export interface WorkspaceGroup {
  id: string;
  workspaceId: string;
  name: string;
  memberIds: string[];
}

/** Every group in the workspace, with its members. */
export async function fetchGroups(workspaceId: string): Promise<WorkspaceGroup[]> {
  const { data, error } = await supabase
    .from('workspace_groups')
    .select('id, workspace_id, name, workspace_group_members(user_id)')
    .eq('workspace_id', workspaceId)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    memberIds: (row.workspace_group_members ?? []).map((m: any) => m.user_id),
  }));
}

export async function createGroup(workspaceId: string, name: string): Promise<WorkspaceGroup> {
  const { data, error } = await supabase
    .from('workspace_groups')
    .insert({ workspace_id: workspaceId, name: name.trim() })
    .select('id, workspace_id, name')
    .single();
  if (error) throw error;
  return { id: data.id, workspaceId: data.workspace_id, name: data.name, memberIds: [] };
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  const { error } = await supabase.from('workspace_groups').update({ name: name.trim() }).eq('id', groupId);
  if (error) throw error;
}

/**
 * ⚠️ Deleting a group revokes access everywhere it was used, in one step and without warning at the
 * template. `template_access.group_id` is `on delete cascade`, so the rows go with it — a template
 * restricted only to that group becomes reachable by its creator alone.
 *
 * The caller is expected to say so before calling. Silently narrowing access across a workspace is
 * exactly the class of change SQEM-292 exists to make visible.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('workspace_groups').delete().eq('id', groupId);
  if (error) throw error;
}

/** Replace a group's membership wholesale — the shape the editing dialog produces. */
export async function setGroupMembers(groupId: string, userIds: string[]): Promise<void> {
  const { error: delErr } = await supabase.from('workspace_group_members').delete().eq('group_id', groupId);
  if (delErr) throw delErr;
  if (!userIds.length) return;
  const { error } = await supabase
    .from('workspace_group_members')
    .insert(userIds.map(user_id => ({ group_id: groupId, user_id })));
  if (error) throw error;
}

/**
 * How many templates a group currently reaches. Shown before deletion, because "delete Marketing"
 * and "revoke access to 14 templates" are the same act and only the second one is informative.
 */
export async function countTemplatesUsingGroup(groupId: string): Promise<number> {
  // `template_access` is absent from `database.types.ts` — it always has been, and adding it by hand
  // would mean transcribing a table whose shape has changed three times (SQEM-142/210/292). The cast
  // is narrower than it looks: only the count is read, and a wrong answer here shows a wrong number
  // in a confirmation dialog rather than granting anything.
  const { count, error } = await (supabase as any)
    .from('template_access')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if (error) throw error;
  return (count as number | null) ?? 0;
}
