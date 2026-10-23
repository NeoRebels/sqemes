// SQEM-564 — applying one change to many playbooks or personas at once.
//
// Pure on purpose (no `lib/supabase` import), so it is tested directly. The callers pass in the two
// things that touch the database: "which of these may I change" and "change this one".
//
// ⛔ **Ask first, then write — never infer success from a write that returned no error.** Clearing a
// playbook's access deletes its `template_access` rows, and for someone without the edit right RLS
// deletes nothing and reports no error. A bulk action that only counted errors would announce
// "access changed" for playbooks it never touched. So every id is checked with `can_edit_*` first and
// only the allowed ones are written; the rest are reported as skipped.

export type BulkOutcome = { changed: string[]; skipped: string[]; failed: string[] };

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function runLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Check, then write: `canEditMany` decides which ids are skipped, `apply` runs for the rest. An id
 * whose write throws is `failed`, not `changed`.
 */
export async function applyToEditable(
  ids: string[],
  canEditMany: (ids: string[]) => Promise<Set<string>>,
  apply: (id: string) => Promise<void>,
  limit = 4,
): Promise<BulkOutcome> {
  const editable = await canEditMany(ids);
  const toWrite = ids.filter(id => editable.has(id));
  const skipped = ids.filter(id => !editable.has(id));
  const results = await runLimited(toWrite, limit, apply);
  const changed: string[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? changed : failed).push(toWrite[i]));
  return { changed, skipped, failed };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** One toast for the whole action: what changed, what was skipped and why, what failed. */
export function bulkSummary(
  o: BulkOutcome,
  noun: string,
  done: string,
): { message: string; type: 'success' | 'info' | 'error' } {
  const parts: string[] = [];
  if (o.changed.length) parts.push(`${done} for ${plural(o.changed.length, noun)}`);
  if (o.skipped.length) parts.push(`${o.skipped.length} skipped — you may not change ${o.skipped.length === 1 ? 'it' : 'them'}`);
  if (o.failed.length) parts.push(`${o.failed.length} failed`);
  if (!parts.length) return { message: `Nothing to change`, type: 'info' };
  const type = o.failed.length ? 'error' : o.changed.length ? 'success' : 'info';
  const message = parts.join(' · ');
  return { message: message.charAt(0).toUpperCase() + message.slice(1), type };
}

/**
 * How many of these playbooks the person applying a restriction would no longer see. Since SQEM-292
 * admins and editors hold no automatic access: a restricted playbook is visible to its creator and to
 * whoever is named, directly or through a group. The dialog says this number before anything is written.
 */
export function wouldLoseSight(
  playbooks: { createdBy: string | null | undefined }[],
  me: string,
  named: { userIds: string[]; groupIds: string[] },
  groups: { id: string; memberIds: string[] }[],
): number {
  if (named.userIds.includes(me)) return 0;
  if (groups.some(g => named.groupIds.includes(g.id) && g.memberIds.includes(me))) return 0;
  return playbooks.filter(p => p.createdBy !== me).length;
}
