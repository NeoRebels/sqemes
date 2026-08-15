// SQEM-142 Phase 2 / SQEM-143 v2 — template access control.
// Model: template_access holds one row per allowed principal — either a `role` OR a `user_id`
// (a CHECK enforces exactly one). NO rows for a template = open to everyone (admins + the
// creator always have access via RLS regardless). See can_access_template() and the
// prompts_select policy. v1 wrote role rows only; v2 (SQEM-143) also writes per-user rows.
import { supabase } from '../supabase';
import type { UserRole } from '../../types';

// The template_access table is intentionally not in the generated database.types yet (added by
// migration 20260726120000); a thin cast keeps this typed at the call sites without regenerating.
type AccessClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as AccessClient;

/**
 * The principals explicitly granted access.
 *
 * `hasRules` is what separates the two states that both arrive as empty lists (SQEM-210):
 * **no rows at all** = open to everyone, versus **a row naming nobody** = only the creator (plus
 * admins and editors, who are granted by `can_access_template` itself). Without it, "only me" and
 * "everyone" would be indistinguishable on read — they are opposites.
 */
export type TemplateAccess = { roles: UserRole[]; userIds: string[]; hasRules: boolean };

/**
 * The set of template ids in a workspace that have ANY access rule (i.e. are restricted, not
 * open to everyone). Used to show a "restricted" indicator on template cards. One row per rule,
 * so we dedupe into a Set. RLS lets any workspace member read these rows.
 */
export async function fetchRestrictedTemplateIds(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('template_access')
    .select('template_id')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return new Set((data || []).map((r: { template_id: string }) => r.template_id));
}

/** Roles + users explicitly granted access to a template. Both empty ⇒ open to everyone. */
export async function fetchTemplateAccess(templateId: string): Promise<TemplateAccess> {
  const { data, error } = await client
    .from('template_access')
    .select('role, user_id')
    .eq('template_id', templateId);
  if (error) throw error;
  const rows = (data || []) as { role: UserRole | null; user_id: string | null }[];
  return {
    roles: rows.filter(r => r.role != null).map(r => r.role as UserRole),
    userIds: rows.filter(r => r.user_id != null).map(r => r.user_id as string),
    hasRules: rows.length > 0,
  };
}

/**
 * Replace the access rules for a template.
 *
 * `hasRules: false` ⇒ open (all rows removed). `hasRules: true` with no principals ⇒ "only me":
 * a single row naming nobody, which keeps the template out of the "no rules = open" branch while
 * granting no one (SQEM-210).
 *
 * Delete-then-insert (not atomic; a rare mid-write failure leaves the template open, never
 * over-restricted — the safe direction). admin/editor only, enforced by RLS.
 */
export async function setTemplateAccess(
  templateId: string,
  workspaceId: string,
  access: TemplateAccess,
): Promise<void> {
  const del = await client.from('template_access').delete().eq('template_id', templateId);
  if (del.error) throw del.error;

  if (!access.hasRules) return; // open to everyone

  const rows = [
    ...access.roles.map(role => ({ template_id: templateId, workspace_id: workspaceId, role })),
    ...access.userIds.map(user_id => ({ template_id: templateId, workspace_id: workspaceId, user_id })),
  ];
  // Restricted but nobody named — the one row that means "only me".
  const ins = await client.from('template_access').insert(
    rows.length > 0 ? rows : [{ template_id: templateId, workspace_id: workspaceId }],
  );
  if (ins.error) throw ins.error;
}
