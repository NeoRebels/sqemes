// SQEM-326 — persona access control.
//
// The template model, minus the legacy role principal (SQEM-211 stopped writing those; a table
// created in 2026-09 does not inherit them). Three states, and the middle one is a row rather than
// a list — the distinction `hasRules` exists to carry:
//
//   everyone    no rows at all
//   only me     one row naming nobody
//   restricted  one row per named person or group
import { supabase } from '../supabase';
import type { PersonaAccess } from '../personaAccessValue';

type AccessClient = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const client = supabase as unknown as AccessClient;

// The type and the pure mapping live in `lib/personaAccessValue.ts` — see the header there for
// why. Re-exported so call sites keep one import.
export type { PersonaAccess } from '../personaAccessValue';
export { accessValueToPersonaAccess, personaAccessToValue } from '../personaAccessValue';

/**
 * SQEM-330 — the personas in a workspace that carry ANY access rule, for the card badge.
 *
 * One row per rule, deduped into a Set. ⚠️ It answers "is this restricted at all", not "can you see
 * it" — the list the caller already holds went through RLS, so anything they can see is either open
 * or open *to them*, and the badge is a statement about the persona rather than about the reader.
 * The template twin (`fetchRestrictedTemplateIds`) works the same way and for the same reason.
 */
export async function fetchRestrictedPersonaIds(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('persona_access')
    .select('persona_id')
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return new Set((data || []).map((r: { persona_id: string }) => r.persona_id));
}

/** The principals explicitly granted access. Both lists empty + `hasRules` ⇒ "only me". */
export async function fetchPersonaAccess(personaId: string): Promise<PersonaAccess> {
  const { data, error } = await client
    .from('persona_access')
    .select('user_id, group_id')
    .eq('persona_id', personaId);
  if (error) throw error;
  const rows = (data || []) as { user_id: string | null; group_id: string | null }[];
  return {
    userIds: rows.filter(r => r.user_id != null).map(r => r.user_id as string),
    groupIds: rows.filter(r => r.group_id != null).map(r => r.group_id as string),
    hasRules: rows.length > 0,
  };
}

/**
 * Replace a persona's access rules.
 *
 * Delete-then-insert, not atomic. ⚠️ **A failure between the two leaves the persona OPEN, never
 * over-restricted** — the same direction `setTemplateAccess` chose, and for the same reason: an
 * unexpectedly visible persona is noticed and fixed, while one that has locked out its own author
 * is not obviously anybody's bug.
 */
export async function setPersonaAccess(
  personaId: string,
  workspaceId: string,
  access: PersonaAccess,
): Promise<void> {
  const del = await client.from('persona_access').delete().eq('persona_id', personaId);
  if (del.error) throw del.error;

  if (!access.hasRules) return; // open to everyone

  const rows = [
    ...access.userIds.map(user_id => ({ persona_id: personaId, workspace_id: workspaceId, user_id })),
    ...access.groupIds.map(group_id => ({ persona_id: personaId, workspace_id: workspaceId, group_id })),
  ];
  const ins = await client.from('persona_access').insert(
    rows.length > 0 ? rows : [{ persona_id: personaId, workspace_id: workspaceId }],
  );
  if (ins.error) throw ins.error;
}

/**
 * Which of these templates carry an access rule.
 *
 * ⛔ **This is what makes the degradation visible instead of silent.** A persona shared with the
 * workspace can attach a template restricted to its author; colleagues then receive the persona
 * *without* that route and nothing tells anybody. `template_access` is readable by every workspace
 * member (SQEM-142), so the editor can name the restricted attachments to the person creating the
 * persona — who is the only one in a position to do something about it.
 *
 * ⚠️ It answers "is this template restricted **at all**", not "can person X open it". The precise
 * question needs one evaluation per person per template and would still only produce a longer
 * sentence; the author's decision — share the template, or accept that the route is not for
 * everyone — is the same either way.
 */
export async function fetchRestrictedTemplateIdsAmong(
  workspaceId: string,
  templateIds: string[],
): Promise<Set<string>> {
  if (templateIds.length === 0) return new Set();
  const { data, error } = await client
    .from('template_access')
    .select('template_id')
    .eq('workspace_id', workspaceId)
    .in('template_id', templateIds);
  if (error) throw error;
  return new Set((data || []).map((r: { template_id: string }) => r.template_id));
}
