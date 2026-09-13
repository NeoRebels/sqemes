/**
 * SQEM-400 — one word per access state, for the badges on playbook and persona cards.
 *
 * `template_access` / `persona_access` know three states (SQEM-210): **no rows** = open to everyone,
 * **one row naming nobody** = only the creator, **rows naming people, groups or a legacy role** =
 * restricted to those. The card badge used to say "Restricted" for the last two alike — the fetchers
 * selected only the id and answered "has any rule". The editor, on the same data, says *Only me* for
 * the principal-less row (`accessToValue`, SQEM-238); a card and an editor disagreeing about one
 * playbook is how "restricted" stops meaning anything.
 *
 * ⛔ A legacy `role` row (from before SQEM-211) is a principal and counts as **restricted**, not as
 * "only me" — calling a rule this control cannot express "Only me" is the lie SQEM-238 fixed.
 *
 * Pure and import-free on purpose: `lib/api/*` cannot be imported by a unit test (it pulls in
 * `lib/supabase`, which throws without env vars), so the mapping lives here and is tested here.
 */
export type AccessBadgeMode = 'private' | 'restricted';

export type AccessRuleRow = { role?: string | null; user_id?: string | null; group_id?: string | null };

/** The word for a set of rules on ONE entity. `undefined` when there are no rules (open to everyone). */
export function accessBadgeMode(rows: AccessRuleRow[]): AccessBadgeMode | undefined {
  if (rows.length === 0) return undefined;
  const names = rows.some(r => r.role != null || r.user_id != null || r.group_id != null);
  return names ? 'restricted' : 'private';
}

/** Group rule rows by the entity id column and give each entity its word. */
export function accessBadgeModes<K extends string>(
  rows: (AccessRuleRow & Record<K, string>)[],
  idKey: K,
): Map<string, AccessBadgeMode> {
  const byId = new Map<string, AccessRuleRow[]>();
  for (const row of rows) {
    const id = row[idKey];
    const list = byId.get(id) ?? [];
    list.push(row);
    byId.set(id, list);
  }
  const out = new Map<string, AccessBadgeMode>();
  for (const [id, list] of byId) {
    const mode = accessBadgeMode(list);
    if (mode) out.set(id, mode);
  }
  return out;
}

/** The badge's word — the same one the access control uses for the state (`mode: 'private'` = Only me). */
export const ACCESS_BADGE_LABEL: Record<AccessBadgeMode, string> = {
  private: 'Only me',
  restricted: 'Restricted',
};

/** The card badge's tooltip. "Only me" is the creator alone — admins and editors included since SQEM-292. */
export const ACCESS_BADGE_TITLE: Record<AccessBadgeMode, string> = {
  private: 'Only me — visible to its creator alone',
  restricted: 'Restricted — not visible to everyone in this workspace',
};
