/**
 * SQEM-620 — the filters the Playbooks and Personas lists gained (review, 2026-10-29: with
 * many skills in a workspace nobody kept an overview). Pure, so the rule is tested without React.
 *
 * The owner filter was first a "Mine" toggle; the request was for a choice of any owner instead
 * (2026-11-03) — whoever tidies a workspace looks for one colleague's playbooks, not only their own.
 *
 * ⚠️ "Not in a persona" can only know the personas this person may see: RLS returns no other, so a
 * playbook used solely by a persona restricted from them counts as unused. The toggle's tooltip says so.
 */

/** The owner filter's value for "owner no longer in the workspace, or never recorded". */
export const OWNER_GONE = '__gone__';

export interface OwnerMember { id: string; name?: string | null; email: string }

/**
 * The owner filter's options: every member who owns at least one listed item — the person first,
 * marked as them — then one entry for owners who are gone or were never recorded. Two members with
 * the same name are told apart by their address. ⛔ Fewer than two distinct owners → no options at
 * all, and the page shows no filter: a choice with one answer is not a choice (Solo, or a workspace
 * where one person wrote everything).
 */
export function ownerOptions(
  items: ReadonlyArray<{ createdBy?: string | null }>,
  members: ReadonlyArray<OwnerMember>,
  meId: string | null | undefined,
  labels: { you: (name: string) => string; gone: string },
): { value: string; label: string }[] {
  const byId = new Map(members.map(mb => [mb.id, mb]));
  const owners = new Set<string>();
  let gone = false;
  for (const it of items) {
    if (it.createdBy && byId.has(it.createdBy)) owners.add(it.createdBy);
    else gone = true;
  }
  if (owners.size + (gone ? 1 : 0) < 2) return [];
  const nameOf = (mb: OwnerMember) => mb.name || mb.email;
  const counts = new Map<string, number>();
  for (const id of owners) { const n = nameOf(byId.get(id)!); counts.set(n, (counts.get(n) ?? 0) + 1); }
  const label = (mb: OwnerMember) => {
    const n = nameOf(mb);
    const shown = (counts.get(n) ?? 0) > 1 && mb.name ? `${n} (${mb.email})` : n;
    return mb.id === meId ? labels.you(shown) : shown;
  };
  const sorted = [...owners].map(id => byId.get(id)!).sort((a, b) => {
    if (a.id === meId) return -1;
    if (b.id === meId) return 1;
    return nameOf(a).localeCompare(nameOf(b));
  });
  const options = sorted.map(mb => ({ value: mb.id, label: label(mb) }));
  if (gone) options.push({ value: OWNER_GONE, label: labels.gone });
  return options;
}

/** Whether an item passes the owner filter (`null` = all owners). */
export function matchesOwner(
  createdBy: string | null | undefined,
  selected: string | null,
  memberIds: ReadonlySet<string>,
): boolean {
  if (!selected) return true;
  if (selected === OWNER_GONE) return !createdBy || !memberIds.has(createdBy);
  return createdBy === selected;
}

/** Every playbook id at least one of the given personas routes to. */
export function usedTemplateIds(personas: ReadonlyArray<{ routes?: ReadonlyArray<{ templateId: string }> }>): Set<string> {
  const ids = new Set<string>();
  for (const p of personas) for (const r of p.routes ?? []) ids.add(r.templateId);
  return ids;
}
