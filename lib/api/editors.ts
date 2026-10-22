// SQEM-473 — who may CHANGE a playbook or persona, separately from who may see it.
//
// `template_editors` / `persona_editors` hold one row per named person or group. No rows = anyone who
// may edit at all (an admin, or an editor who can see it). The rules live in the database
// (`can_edit_*`, `can_manage_*_editors`) and RLS enforces them; this module only reads and writes the
// lists and asks the rules, so the editor can show the truth instead of guessing it.
import { supabase } from '../supabase';

// Not in the generated database.types (same as template_access); a thin cast keeps call sites typed.
type Client = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as Client;

export type EditorKind = 'template' | 'persona';
export type Editors = { userIds: string[]; groupIds: string[] };

const TABLE: Record<EditorKind, string> = { template: 'template_editors', persona: 'persona_editors' };
const KEY: Record<EditorKind, string> = { template: 'template_id', persona: 'persona_id' };

export async function fetchEditors(kind: EditorKind, id: string): Promise<Editors> {
  const { data, error } = await client.from(TABLE[kind]).select('user_id, group_id').eq(KEY[kind], id);
  if (error) throw error;
  const rows = (data || []) as { user_id: string | null; group_id: string | null }[];
  return {
    userIds: rows.filter(r => r.user_id).map(r => r.user_id as string),
    groupIds: rows.filter(r => r.group_id).map(r => r.group_id as string),
  };
}

/**
 * Replace the editor list. Empty = no restriction. Only the owner or an admin may (RLS); anyone else
 * gets an error, which the caller shows.
 *
 * Delete-then-insert, not atomic: a failure in between leaves the playbook UNRESTRICTED (anyone who may
 * edit at all), never locked — the recoverable direction.
 */
export async function setEditors(kind: EditorKind, id: string, workspaceId: string, editors: Editors): Promise<void> {
  const del = await client.from(TABLE[kind]).delete().eq(KEY[kind], id);
  if (del.error) throw del.error;
  const rows = [
    ...editors.userIds.map(user_id => ({ [KEY[kind]]: id, workspace_id: workspaceId, user_id })),
    ...editors.groupIds.map(group_id => ({ [KEY[kind]]: id, workspace_id: workspaceId, group_id })),
  ];
  if (rows.length === 0) return;
  const ins = await client.from(TABLE[kind]).insert(rows);
  if (ins.error) throw ins.error;
}

/** What the database says this person may do with it: change it, and set its editor list. */
export async function fetchEditRights(kind: EditorKind, id: string): Promise<{ canEdit: boolean; canManage: boolean }> {
  const [edit, manage] = await Promise.all([
    client.rpc(kind === 'template' ? 'can_edit_template' : 'can_edit_persona', kind === 'template' ? { p_template_id: id } : { p_persona_id: id }),
    client.rpc(kind === 'template' ? 'can_manage_template_editors' : 'can_manage_persona_editors', kind === 'template' ? { p_template_id: id } : { p_persona_id: id }),
  ]);
  // Fails OPEN here on purpose: this only decides what the editor SHOWS. RLS refuses the write anyway,
  // and a read error must not lock somebody out of a playbook they may edit.
  return { canEdit: edit.error ? true : edit.data !== false, canManage: manage.error ? false : manage.data === true };
}
