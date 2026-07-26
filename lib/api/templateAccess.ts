// SQEM-142 Phase 2 — role-based template access.
// Model: template_access holds one row per allowed principal. For v1 only `role` rows are
// written. NO rows for a template = open to everyone (admins + the creator always have access
// via RLS regardless). See can_access_template() and the prompts_select policy.
import { supabase } from '../supabase';
import type { UserRole } from '../../types';

// The template_access table is intentionally not in the generated database.types yet (added by
// migration 20260726120000); a thin cast keeps this typed at the call sites without regenerating.
type AccessClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as AccessClient;

/** Roles explicitly granted access to a template. Empty ⇒ the template is open to everyone. */
export async function fetchTemplateAccessRoles(templateId: string): Promise<UserRole[]> {
  const { data, error } = await client
    .from('template_access')
    .select('role')
    .eq('template_id', templateId)
    .not('role', 'is', null);
  if (error) throw error;
  return (data || []).map((r: { role: UserRole }) => r.role);
}

/**
 * Replace the role access rules for a template. Empty `roles` ⇒ open (all role rows removed).
 * Delete-then-insert (not atomic; a rare mid-write failure leaves the template open, never
 * over-restricted — the safe direction). admin/editor only, enforced by RLS.
 */
export async function setTemplateAccessRoles(
  templateId: string,
  workspaceId: string,
  roles: UserRole[],
): Promise<void> {
  const del = await client
    .from('template_access')
    .delete()
    .eq('template_id', templateId)
    .not('role', 'is', null);
  if (del.error) throw del.error;

  if (roles.length === 0) return; // open
  const rows = roles.map(role => ({ template_id: templateId, workspace_id: workspaceId, role }));
  const ins = await client.from('template_access').insert(rows);
  if (ins.error) throw ins.error;
}
