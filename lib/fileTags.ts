// SQEM-253 — what a bulk tag change actually does, decided outside the component.
//
// The component can then stay a loop over a plan, and the two cases that are easy to get wrong get
// tested without a DOM: a **mixed selection** (some files already carry the tag) and a **partial
// failure** (some writes land, some do not).

export type TaggableFile = { id: string; tags: string[] };

/**
 * Which of the selected files actually change, and to what.
 *
 * **Adding is idempotent.** Files that already carry the tag are left alone, so a mixed selection is
 * not a special case and there is nothing to ask about — the same in reverse for removal. An empty
 * plan means the selection already looks the way someone asked it to look; that is success, not a
 * failure needing an error.
 */
export function planTagChange(
  files: readonly TaggableFile[],
  selectedIds: ReadonlySet<string>,
  tag: string,
  mode: 'add' | 'remove',
): { id: string; tags: string[] }[] {
  return files
    .filter(f => selectedIds.has(f.id) && (mode === 'add' ? !f.tags.includes(tag) : f.tags.includes(tag)))
    .map(f => ({
      id: f.id,
      tags: mode === 'add' ? [...f.tags, tag] : f.tags.filter(t => t !== tag),
    }));
}

/** The tags carried by at least one selected file — what a "remove" control may offer. */
export function tagsOnSelection(files: readonly TaggableFile[], selectedIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  for (const f of files) if (selectedIds.has(f.id)) for (const t of f.tags) seen.add(t);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * What to say afterwards.
 *
 * A partial failure names **both** numbers: "7 of 10" tells someone what to do next, "something went
 * wrong" does not. The caller keeps the selection on that path, so the retry is one click — which is
 * also why nothing is rolled back here. A tag that landed is not damage.
 */
export function tagChangeSummary(
  ok: number,
  planned: number,
  tag: string,
  mode: 'add' | 'remove',
): { text: string; ok: boolean } {
  const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;
  if (planned === 0) {
    return {
      text: `Nothing to change — every selected file already ${mode === 'add' ? 'has' : 'lacks'} “${tag}”.`,
      ok: true,
    };
  }
  if (ok === planned) {
    return {
      text: mode === 'add' ? `Added “${tag}” to ${files(ok)}.` : `Removed “${tag}” from ${files(ok)}.`,
      ok: true,
    };
  }
  return {
    text: mode === 'add'
      ? `Added “${tag}” to ${ok} of ${files(planned)} — the rest failed and stay selected.`
      : `Removed “${tag}” from ${ok} of ${files(planned)} — the rest failed and stay selected.`,
    ok: false,
  };
}
