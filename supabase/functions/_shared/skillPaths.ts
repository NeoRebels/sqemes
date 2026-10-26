/**
 * SQEM-499 — paths inside a skill, the way the Agent Skills standard speaks about them.
 *
 * A skill's SKILL.md refers to its files by path relative to the skill folder (`references/x.md`),
 * while `workspace_files.name` keeps whatever path the file was stored under — sometimes with the
 * skill folder in front (`diagram-design/references/x.md`), sometimes without. Names are also NOT
 * unique in a workspace (duplicates are common), so a path is only ever
 * resolved among the files of ONE skill, never workspace-wide.
 *
 * Pure (no imports) so tests/unit/skillPaths.test.ts can pin every case.
 */

/** Strips `./` and leading slashes; refuses `..` so a path can never climb out of the skill. */
export function normalizeSkillPath(path: string): string | null {
  const p = String(path ?? '').trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!p || p.split('/').some(seg => seg === '..')) return null;
  return p;
}

export type PathMatch =
  | { kind: 'found'; id: string; name: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

/**
 * Finds `path` among a skill's files: an exact name wins; otherwise a name that ends in `/<path>`
 * (the skill folder or any prefix in front). Several suffix matches are reported, never guessed —
 * picking one would hand the model a file it did not ask for and it would not know.
 */
export function matchSkillPath(files: Array<{ id: string; name: string }>, path: string): PathMatch {
  const p = normalizeSkillPath(path);
  if (!p) return { kind: 'none' };
  const exact = files.filter(f => f.name === p);
  if (exact.length === 1) return { kind: 'found', id: exact[0].id, name: exact[0].name };
  const pool = exact.length > 1 ? exact : files.filter(f => f.name.endsWith(`/${p}`));
  if (pool.length === 1) return { kind: 'found', id: pool[0].id, name: pool[0].name };
  if (pool.length > 1) return { kind: 'ambiguous', candidates: pool.map(f => f.name).sort() };
  return { kind: 'none' };
}

/**
 * The standard's folders for files that are NOT context: `assets/` (templates, images, fonts) and
 * `scripts/` (code). They are listed by path, size and type only — no text, no preview — and read on
 * demand. Anything else stays context, which is how almost every skill here is laid out.
 * A segment counts only as a folder (never the file name itself), anywhere in the path, because the
 * skill folder may or may not be in front of it.
 */
export function isResourcePath(name: string): boolean {
  const segs = String(name ?? '').split('/');
  return segs.slice(0, -1).some(s => s === 'assets' || s === 'scripts');
}

/**
 * SQEM-514 — the paths a skill's files have INSIDE the skill folder, for `download_skill`. A file
 * imported with the skill folder in front (`docx/scripts/pack.py`, SQEM-251) is written as
 * `scripts/pack.py`; that prefix is stripped only when EVERY file carries it, so a skill whose files
 * were uploaded skill-relative keeps its paths exactly. Unsafe paths fall back to the bare file name.
 */
export function relativeSkillPaths(names: string[], slug: string): string[] {
  const prefix = `${slug}/`;
  const strip = names.length > 0 && names.every(n => n.startsWith(prefix));
  return names.map(n => {
    const rel = strip ? n.slice(prefix.length) : n;
    return normalizeSkillPath(rel) ?? (rel.split('/').pop() || 'file');
  });
}

/**
 * SQEM-592 — the visible name of a file finalised after a signed-URL upload: the name create_upload_url
 * was given, never the storage key, whose `/` are defused to `_` (`storageKey.ts`). The key is the
 * fallback only for a URL issued before `pending_uploads` existed.
 */
export function uploadedFileName(announced: string | null | undefined, storageObjectName: string): string {
  return announced?.trim() ? announced : storageObjectName;
}
