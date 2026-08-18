// SQEM-248 — the Deno half of the SKILL.md frontmatter reader.
//
// ⚠️ **This is a twin of `lib/skillBundle.ts`, not a variant.** The edge functions and the browser
// bundle share no module system, so the reader exists twice; `tests/unit/skillImport.test.ts` reads
// both files and fails if the two bodies stop agreeing. Same arrangement as
// `lib/storageKey.ts` ↔ `_shared/storageKey.ts` (SQEM-237) — if that test goes red, fix the copy,
// do not relax the test.
//
// Why the edge side needs it at all: the URL importer writes `content` straight into `prompts`. If
// it stored the raw SKILL.md, every imported skill would carry its frontmatter inside its body — the
// exact state SQEM-249 exists to repair. Parsing here means the import never creates the defect.

/** The three fields a SKILL.md header carries into a Sqemes template. */
type SkillBundle = { title: string; description: string; content: string };

/**
 * SQEM-251 — the skill's own folder name, which is also the prefix its files carry in the workspace.
 * Twinned like the rest of this file; the browser copy is the one `buildSkillMd` writes into
 * frontmatter, so a drift here would silently change where imported files land.
 */
export function toSlug(title: string): string {
  return title.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'skill';
}

const yamlUnquote = (v: string) => {
  const t = v.trim();
  if (!(t.startsWith('"') && t.endsWith('"') && t.length >= 2)) return t;
  return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
};

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
