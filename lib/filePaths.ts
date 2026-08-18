// SQEM-244 (from SQEM-236) — a slash in a file name means a folder, and the interface says so.
//
// `workspace_files.name` has always carried a path verbatim; SQEM-243 made that load-bearing, because
// it is how an Agent Skill's directory structure survives a round trip. Until now nothing *read* it
// as a path, so a skill with eleven files in three folders looked like eleven unrelated files with
// long names.
//
// ⚠️ **SQEM-254 — this now has exactly one caller: `ContextFilePicker`. The Files page does not
// group by path any more, and that was a deliberate reversal, not neglect.**
//
// The owner's argument, which nothing answered: a folder claims a file belongs to one thing, and in
// Sqemes a file hangs on as many templates as you like. SQEM-251 made that worse rather than better
// by putting the skill's own slug in front — the name then *asserted* an owner. And the place where
// a folder tree would have earned its keep turns out to be solved differently already: over MCP,
// context files load on demand with names and previews (SQEM-230/232), so nobody navigates a tree
// to find one.
//
// **Why the picker keeps it:** there you are choosing files *for one specific template*. The context
// is unambiguous, so the grouping claims nothing false — and the alternative is a flat list of 151
// entries to pick from. The asymmetry is the point; do not "unify" it away.
//
// Still true and still load-bearing: *this module only reads.* Strip every prefix in the database
// and nothing here breaks. The path itself stays in `name` because the **export** has to rebuild the
// skill folder from it (SQEM-243) — it is structure, not decoration, and it is no longer a claim
// about ownership because nothing renders it as one.
//
// The model behind all of it — a path is an attribute of the *attachment* — is **SQEM-252**.
//
// The deliberate imperfection: a file genuinely called `Vertrag 01/2026.pdf` becomes a folder named
// "Vertrag 01". Accepted (SQEM-244). The alternative is a second field asking "is this a path?", a
// question nobody wants to answer while uploading.

/** `scripts/a/b.py` → `scripts/a`. A name without a slash lives at the root and returns ''. */
export function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? '' : name.slice(0, i);
}

/** `scripts/a/b.py` → `b.py`. What to show once the folder is named by the group header. */
export function baseNameOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i === -1 ? name : name.slice(i + 1);
}

/** Is there anything to group? A folder tree over a flat shelf is empty hierarchy. */
export function hasFolders(items: { name: string }[]): boolean {
  return items.some(f => f.name.includes('/'));
}

/**
 * Group by folder, preserving the order the caller already chose within each group — the Files page
 * sorts by date / size / usage, and a grouping that re-sorted would quietly override that.
 *
 * Root files come first, then folders alphabetically: the ungrouped things are what someone scanning
 * the page is most likely to be looking for, and burying them under an alphabetical accident of
 * folder names is worse than a rule that never surprises.
 */
export function groupByFolder<T extends { name: string }>(items: T[]): { folder: string; files: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = folderOf(item.name);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .map(([folder, files]) => ({ folder, files }))
    .sort((a, b) => (a.folder === '' ? -1 : b.folder === '' ? 1 : a.folder.localeCompare(b.folder)));
}
