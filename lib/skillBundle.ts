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
// Claude Code runs it. That division is a guardrail in `pm/VISION.md`, not an oversight.
import JSZip from 'jszip';

export const SKILL_ENTRY = 'SKILL.md';
const MAX_SKILL_FILES = 100;
const MAX_SKILL_BYTES = 100 * 1024 * 1024; // zip-bomb guard, same reasoning as templateBundle

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

export function buildSkillMd(b: Pick<SkillBundle, 'title' | 'description' | 'content'>): string {
  const lines = [
    '---',
    `name: ${toSlug(b.title)}`,
    `title: ${yamlQuote(b.title)}`,
    `description: ${yamlQuote(b.description || '')}`,
    '---',
    '',
  ];
  return lines.join('\n') + b.content;
}

/**
 * The inverse. **A missing or malformed frontmatter is not an error** — the whole file becomes the
 * body and the title is derived. An import that fails on a missing header is precisely the friction
 * that sends people back to `curl`-ing an unpinned `main` at runtime, which is the workaround
 * SQEM-236 exists to make unnecessary.
 */
export function readSkillMd(md: string, fallbackTitle = 'Imported skill'): Pick<SkillBundle, 'title' | 'description' | 'content'> {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { title: deriveTitle(md, fallbackTitle), description: '', content: md };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = yamlUnquote(kv[2]);
  }
  const content = md.slice(match[0].length);
  return {
    // `title` is ours and exact; `name` is the Agent-Skill slug and only a fallback.
    title: meta.title || meta.name || deriveTitle(content, fallbackTitle),
    description: meta.description || '',
    content,
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

/**
 * Unpack a skill folder.
 *
 * Two things real-world zips need and a naive reader gets wrong:
 * **a single wrapping directory** (`my-skill/SKILL.md` — what you get zipping a folder) is stripped,
 * and **macOS metadata** (`__MACOSX/`, `.DS_Store`) is dropped, or every import from a Mac arrives
 * carrying junk files nobody asked for.
 */
export async function readSkillZip(file: File): Promise<SkillBundle> {
  const zip = await JSZip.loadAsync(file);

  const entries = Object.values(zip.files).filter(e => !e.dir && !isJunk(e.name));
  if (!entries.length) throw new Error('The archive is empty.');
  if (entries.length > MAX_SKILL_FILES) throw new Error(`Too many files (${entries.length}, max ${MAX_SKILL_FILES}).`);

  const prefix = commonRootDir(entries.map(e => e.name));
  const strip = (p: string) => (prefix ? p.slice(prefix.length + 1) : p);

  const skillEntry = entries.find(e => strip(e.name) === SKILL_ENTRY);
  if (!skillEntry) throw new Error(`No ${SKILL_ENTRY} found — this does not look like an Agent Skill.`);

  const head = readSkillMd(await skillEntry.async('string'), prefix || 'Imported skill');

  const files: SkillBundle['files'] = [];
  let total = 0;
  for (const e of entries) {
    if (e === skillEntry) continue;
    const blob = await e.async('blob');
    total += blob.size;
    if (total > MAX_SKILL_BYTES) throw new Error('The archive exceeds the size limit.');
    files.push({ name: strip(e.name), blob, mimeType: blob.type || '' });
  }
  return { ...head, files };
}

const isJunk = (p: string) => p.startsWith('__MACOSX/') || p.split('/').pop() === '.DS_Store';

/** The single top-level directory shared by every entry, or '' when there isn't one. */
function commonRootDir(paths: string[]): string {
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const root = first[0];
  return paths.every(p => p.startsWith(`${root}/`)) ? root : '';
}
