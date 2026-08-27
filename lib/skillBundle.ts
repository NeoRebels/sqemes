// SQEM-243 (from SQEM-236) — an Anthropic Agent Skill, in and out, without losing anything.
//
// An Agent Skill is a *folder*: a `SKILL.md` carrying instructions plus frontmatter, and whatever
// files sit beside it. Sqemes could always store those files — `workspace_files.name` keeps a path
// verbatim (measured 2026-08-17 through the production MCP connection, and the sanitised
// `storage_path` is what keeps that safe, see `lib/storageKey.ts`). What was missing was *meaning*:
// nothing read the folder in, and nothing wrote it back out.
//
// **This is not a second `.sqemes.zip`.** One format per job, decided in SQEM-236:
//
//   .sqemes.zip        the full export — a prompt with its variables, an assistant, workspace
//                      metadata. A skill folder cannot express any of that.
//   SKILL.md + files   the interchange format for the *skill* kind, in and out.
//
// Two formats for the *same* job would be exactly the failure this ticket exists to prevent.
//
// **Sqemes still does not execute anything.** A `scripts/*.py` in here is carried and handed back;
// Claude Code runs it. That division is deliberate and load-bearing: the moment Sqemes runs a
// contributed script, it inherits every sandboxing and supply-chain problem that comes with it, and
// a marketplace of shared skills turns that into someone else's code on our machines. Storing and
// handing back has no such edge. Do not "finish" this by adding execution.
import JSZip from 'jszip';

export const SKILL_ENTRY = 'SKILL.md';
// SQEM-250 — was 100, which no real skill fits: `diagram-design` is 152 files. The workaround
// everyone reaches for ("just zip the skill folder") therefore failed too, one wall further in.
// 500 matches the MCP importer's cap, so the two paths accept the same archives.
const MAX_SKILL_FILES = 500;
const MAX_SKILL_BYTES = 100 * 1024 * 1024; // zip-bomb guard, same reasoning as templateBundle

/**
 * SQEM-250 — why a skill archive was rejected, so the caller can say something true about it.
 *
 * `kind: 'none'` is the only case where the file might be neither format; every other kind means
 * "this IS a skill archive and here is what is wrong with it". Without that distinction the import
 * UI had to guess, and guessed by *order of attempts* — which is how a repo zip containing a
 * perfectly good SKILL.md came to be reported as "manifest.json missing".
 */
export class SkillArchiveError extends Error {
  constructor(
    message: string,
    readonly kind: 'none' | 'ambiguous' | 'empty' | 'too-many' | 'too-big',
    /** The candidate skill folders, when `kind` is `'ambiguous'` — so a caller can say which. */
    readonly folders: string[] = [],
  ) {
    super(message);
    this.name = 'SkillArchiveError';
  }
}

/**
 * What to tell someone whose file was read as neither format.
 *
 * The bundle error only earns the screen when the archive really is neither — `kind: 'none'`. In
 * every other case the file *is* a skill archive with something specific wrong, and saying
 * "manifest.json missing" about it is worse than saying nothing: it names a format the person was
 * not using and hides the one they were.
 *
 * The ambiguous case is rebuilt here rather than passed through, because the shared rule's sentence
 * ends in `Name one with "path"` — true for the MCP importer, meaningless at a file picker. A
 * message that names a control the reader does not have is the same failure in a smaller size.
 */
export function importErrorMessage(bundleErr: unknown, skillErr: unknown): string {
  if (skillErr instanceof SkillArchiveError && skillErr.kind !== 'none') {
    if (skillErr.kind === 'ambiguous') {
      return `This archive holds ${skillErr.folders.length} skills — ${skillErr.folders.join(', ')}. Zip just the one you want and import that.`;
    }
    return skillErr.message;
  }
  const detail = bundleErr instanceof Error ? bundleErr.message : 'it could not be read';
  return `Neither a Sqemes bundle nor an Agent Skill: no ${SKILL_ENTRY} anywhere in the archive, and ${detail.charAt(0).toLowerCase()}${detail.slice(1)}.`;
}

/** What a skill folder holds, independent of how it is packed. */
export type SkillBundle = {
  title: string;
  description: string;
  /** The body of SKILL.md — everything after the frontmatter. */
  content: string;
  files: { name: string; blob: Blob; mimeType: string }[];
};

// ---- SKILL.md --------------------------------------------------------------------------------

/**
 * Anthropic's frontmatter carries `name` (a slug) and `description`. A slug cannot be turned back
 * into "Gesellschafter-Steuerberatung (NeoRebels GmbH)", so a round trip through `name` alone loses
 * the human title. We therefore write **both**: `name` for anyone reading this as an Agent Skill,
 * `title` for the round trip back into Sqemes.
 *
 * That is also the habit borrowed from Google's Open Knowledge Format (SQEM-236) — the metadata
 * belongs *in the file*, not only in database columns, or a skill leaves here as a folder with no
 * label on it. OKF itself is deliberately **not** supported as a second format.
 */
export function toSlug(title: string): string {
  return title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'skill';
}

/** YAML double-quoted scalar — the one form that survives colons, quotes and newlines in a title. */
const yamlQuote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
const yamlUnquote = (v: string) => {
  const t = v.trim();
  if (!(t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return t;
  return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
};

/**
 * SQEM-249 — the keys the frontmatter block holds on **our** behalf. Everything else in that block
 * belongs to whoever wrote the skill, and is none of our business beyond carrying it.
 */
export const OWN_FRONTMATTER_KEYS = ['name', 'title', 'description'];

/**
 * Split a leading frontmatter block into the keys we own, the lines we do not, and the body.
 *
 * **The foreign half is kept as raw lines, never parsed into a map.** That is the whole design: a
 * map would have to be written back out, and our reader is line-anchored — `metadata:` matches with
 * an empty value while its indented `  version: "2.4"` matches nothing at all. Re-emitting from a map
 * therefore writes `metadata:` and drops what was under it. **The merge that is easy to write
 * destroys exactly what it is for**; keeping the lines verbatim cannot, because nothing interprets
 * them.
 *
 * Indented continuations of a key we *do* own travel with it, or removing `description: >` would
 * leave its folded lines behind as orphans.
 */
export function splitFrontmatter(md: string): { own: Record<string, string>; foreign: string[]; body: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { own: {}, foreign: [], body: md };

  const own: Record<string, string> = {};
  const foreign: string[] = [];
  let takingOwn = false;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      takingOwn = OWN_FRONTMATTER_KEYS.includes(kv[1].toLowerCase());
      if (takingOwn) { own[kv[1].toLowerCase()] = yamlUnquote(kv[2]); continue; }
    } else if (takingOwn) {
      continue;
    }
    foreign.push(line);
  }
  return { own, foreign, body: md.slice(match[0].length) };
}

/**
 * Rewrite a skill body so its leading block holds **only** the keys we do not own — ours live in
 * columns, and a copy in the body is a second truth that drifts the moment someone renames the skill
 * in Sqemes. Used by the MCP write path (SQEM-249); the exported twin does the same on the edge.
 */
export function withoutOwnFrontmatter(content: string): string {
  const { foreign, body } = splitFrontmatter(content);
  if (!foreign.length) return body;
  return `---\n${foreign.join('\n')}\n---\n${body}`;
}

export function buildSkillMd(b: Pick<SkillBundle, 'title' | 'description' | 'content'>): string {
  // SQEM-249 — anything the author put here that is not ours rides along, in its own words. This
  // used to prepend unconditionally, so a body that still carried its author's header exported with
  // two stacked blocks and their `license:` stopped being a licence.
  const { foreign, body } = splitFrontmatter(b.content);
  const lines = [
    '---',
    `name: ${toSlug(b.title)}`,
    `title: ${yamlQuote(b.title)}`,
    `description: ${yamlQuote(b.description || '')}`,
    ...foreign,
    '---',
    '',
  ];
  return lines.join('\n') + body;
}

/**
 * The inverse. **A missing or malformed frontmatter is not an error** — the whole file becomes the
 * body and the title is derived. An import that fails on a missing header is precisely the friction
 * that sends people back to `curl`-ing an unpinned `main` at runtime, which is the workaround
 * SQEM-236 exists to make unnecessary.
 */
export function readSkillMd(md: string, fallbackTitle = 'Imported skill'): Pick<SkillBundle, 'title' | 'description' | 'content'> {
  const { own, body } = splitFrontmatter(md);
  if (!Object.keys(own).length && body === md) return { title: deriveTitle(md, fallbackTitle), description: '', content: md };
  return {
    // `title` is ours and exact; `name` is the Agent-Skill slug and only a fallback.
    title: own.title || own.name || deriveTitle(body, fallbackTitle),
    description: own.description || '',
    // SQEM-249 — the author's own keys ride along in the body, because there is nowhere else for
    // them. Returning the bare body here would drop a `license:` at import, which is the same loss
    // the export was just taught to avoid — the invariant has to hold on every path or it holds on
    // none.
    content: withoutOwnFrontmatter(md),
  };
}

/** First markdown heading, else the fallback. Used only when nothing else names the skill. */
function deriveTitle(body: string, fallback: string): string {
  const h = body.match(/^\s*#\s+(.+?)\s*$/m);
  return h ? h[1] : fallback;
}

// ---- Zip -------------------------------------------------------------------------------------

/**
 * Pack a skill folder. Separated from the network on purpose: the round-trip test packs and unpacks
 * without touching storage, which is what makes the invariant testable at all.
 */
export async function buildSkillZip(b: SkillBundle): Promise<Blob> {
  const zip = new JSZip();
  zip.file(SKILL_ENTRY, buildSkillMd(b));
  for (const f of b.files) {
    // A context file literally called SKILL.md would overwrite the instructions. Refuse loudly
    // rather than produce a bundle that silently lost its own body.
    if (normalisePath(f.name) === SKILL_ENTRY) {
      throw new Error(`A context file is named ${SKILL_ENTRY}, which would replace the skill's instructions. Rename it first.`);
    }
    zip.file(normalisePath(f.name), f.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

/** `./a//b` → `a/b`, and never leading `/` — a zip entry path is relative by definition. */
function normalisePath(name: string): string {
  return name.replace(/\\/g, '/').split('/').filter(p => p && p !== '.').join('/');
}

// ---- The workspace boundary (SQEM-251) ---------------------------------------------------------

/**
 * Where a skill's file sits **in the workspace**, as opposed to inside the skill.
 *
 * The two are not the same namespace, and conflating them was the defect. `references/style-guide.md`
 * is true relative to *a skill*; `workspace_files.name` is workspace-wide, has no unique constraint,
 * and the Files page groups by prefix — so the second imported skill merges its `references/` into
 * the first one's, every time, and a same-named file lands as an indistinguishable twin row.
 *
 * The skill's own folder name is what connects the two, so it is what we prepend. Note this is the
 * *convention*, not the model: the path is really an attribute of the attachment, and a file attached
 * to two skills still carries only one prefix. **SQEM-252** is where that gets fixed properly; this
 * makes it collision-free and visible in the meantime.
 */
export function workspacePathFor(title: string, nameInSkill: string): string {
  return `${toSlug(title)}/${normalisePath(nameInSkill)}`;
}

/**
 * The inverse, and deliberately the *reader's* rule rather than a second one: strip whatever single
 * directory every name shares. Writer and reader then mean the same thing by "the wrapping level",
 * instead of two rules that can drift apart.
 *
 * Returns `''` when the names share no root — someone attached an ordinary workspace file to the
 * skill after the import. Nothing is stripped then, and that file exports beside the folder where a
 * person can see it, which beats guessing on its behalf.
 */
export function commonRootDir(paths: string[]): string {
  if (!paths.length) return '';
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const root = first[0];
  return paths.every(p => p.startsWith(`${root}/`)) ? root : '';
}

// ---- Finding the skill (twins of `supabase/functions/_shared/skillArchive.ts`) ------------------
//
// ⚠️ **Identical copies, guarded by `tests/unit/skillImport.test.ts`.** The edge functions and the
// browser bundle share no module system, so the rule that decides *which folder is the skill* exists
// twice — and it must be the same rule, or the MCP importer and the file-picker importer would
// disagree about the same archive. If that test goes red, fix the copy; do not relax it.

/** Zip entries no archive meant to ship — a Mac packs them in, GitHub does not. */
export function isArchiveJunk(path: string): boolean {
  return path.startsWith('__MACOSX/') || path === '.DS_Store' || path.endsWith('/.DS_Store');
}

/**
 * Find the folder that *is* the skill, and return its prefix (with trailing slash, or `''` at the
 * archive root). A GitHub zipball wraps everything in `owner-repo-sha/`, so searching for the
 * SKILL.md rather than assuming a depth is what makes the wrapper a non-issue.
 *
 * **Ambiguity is refused, not resolved.** A repository can hold several skills (`skills/a`,
 * `skills/b`); picking the first would import something the caller did not ask for and say nothing —
 * which is the exact failure mode SQEM-248 exists to end.
 */
export function findSkillRoot(paths: string[], subPath?: string | null): string {
  const entries = paths.filter((p) => !isArchiveJunk(p));
  let candidates = entries.filter((p) => p === SKILL_ENTRY || p.endsWith(`/${SKILL_ENTRY}`));

  const want = (subPath ?? '').replace(/^\/+|\/+$/g, '');
  if (want) {
    const narrowed = candidates.filter((p) => p === `${want}/${SKILL_ENTRY}` || p.endsWith(`/${want}/${SKILL_ENTRY}`));
    if (!narrowed.length) {
      throw new Error(`No ${SKILL_ENTRY} under "${want}". Found: ${candidates.join(', ') || 'none anywhere in the archive'}`);
    }
    candidates = narrowed;
  }

  if (!candidates.length) {
    throw new Error(`No ${SKILL_ENTRY} in the archive — an Agent Skill is a folder with a ${SKILL_ENTRY} in it.`);
  }
  if (candidates.length > 1) {
    const folders = candidates.map((p) => p.slice(0, -SKILL_ENTRY.length - 1)).join(', ');
    throw new Error(`This archive holds ${candidates.length} skills. Name one with "path": ${folders}`);
  }

  const only = candidates[0];
  return only === SKILL_ENTRY ? '' : only.slice(0, only.length - SKILL_ENTRY.length);
}

/**
 * Unpack a skill folder.
 *
 * Three things real-world zips need and a naive reader gets wrong:
 * **the skill can sit at any depth** — `my-skill/SKILL.md` when you zip a folder, but
 * `repo-main/skills/<name>/SKILL.md` when you use GitHub's "Download ZIP", which is what a person
 * actually has when they find a skill online (SQEM-250); **everything outside that folder is not
 * part of the skill** and must not be imported as context; and **macOS metadata** (`__MACOSX/`,
 * `.DS_Store`) is dropped, or every import from a Mac arrives carrying junk nobody asked for.
 */
export async function readSkillZip(file: File): Promise<SkillBundle> {
  const zip = await JSZip.loadAsync(file);

  const entries = Object.values(zip.files).filter(e => !e.dir && !isArchiveJunk(e.name));
  if (!entries.length) throw new SkillArchiveError('The archive is empty.', 'empty');

  // SQEM-250 — find the skill wherever it is, instead of insisting it sit one level down. A GitHub
  // "Download ZIP" is `repo-main/skills/<name>/SKILL.md`, which is what a person actually has when
  // they find a skill online; the old rule stripped exactly one wrapper and then looked at the root.
  const root = findSkillRootOrThrow(entries.map(e => e.name));

  // Everything outside that folder is somebody else's repository — README, docs, other skills —
  // and importing it as context would be worse than the bug being fixed.
  const inSkill = entries.filter(e => e.name.startsWith(root));
  if (inSkill.length > MAX_SKILL_FILES) {
    throw new SkillArchiveError(`This skill has ${inSkill.length} files, more than the ${MAX_SKILL_FILES} allowed in one import.`, 'too-many');
  }

  const strip = (p: string) => p.slice(root.length);
  const skillEntry = inSkill.find(e => strip(e.name) === SKILL_ENTRY)!;
  const head = readSkillMd(await skillEntry.async('string'), lastSegment(root) || 'Imported skill');

  const files: SkillBundle['files'] = [];
  let total = 0;
  for (const e of inSkill) {
    if (e === skillEntry) continue;
    const blob = await e.async('blob');
    total += blob.size;
    if (total > MAX_SKILL_BYTES) throw new SkillArchiveError('The archive exceeds the size limit.', 'too-big');
    files.push({ name: strip(e.name), blob, mimeType: blob.type || '' });
  }
  return { ...head, files };
}

/**
 * `findSkillRoot` with the failure classified, so the import UI can tell "not a skill" from "a skill
 * with a problem". The predicate is re-derived rather than parsed out of the message — a decision
 * that turns on string matching is one refactor away from being wrong.
 */
function findSkillRootOrThrow(paths: string[]): string {
  try {
    return findSkillRoot(paths);
  } catch (err) {
    const candidates = paths.filter(p => !isArchiveJunk(p) && (p === SKILL_ENTRY || p.endsWith(`/${SKILL_ENTRY}`)));
    throw new SkillArchiveError(
      (err as Error).message,
      candidates.length ? 'ambiguous' : 'none',
      candidates.map(p => p.slice(0, Math.max(0, p.length - SKILL_ENTRY.length - 1))),
    );
  }
}

/** `a/b/c/` → `c`. The skill's own folder name, which is the best fallback title we have. */
function lastSegment(root: string): string {
  return root.replace(/\/+$/, '').split('/').pop() ?? '';
}
