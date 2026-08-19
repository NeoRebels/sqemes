// SQEM-248/249 — the Deno half of the SKILL.md frontmatter rules.
//
// ⚠️ **This is a twin of `lib/skillBundle.ts`, not a variant.** The edge functions and the browser
// bundle share no module system, so these exist twice; `tests/unit/skillImport.test.ts` reads both
// files and fails if any body stops agreeing. Same arrangement as `lib/storageKey.ts` ↔
// `_shared/storageKey.ts` (SQEM-237) — if that test goes red, fix the copy, do not relax the test.
//
// ⚠️ **The pair now covers seven functions across two edge files.** That is past the point where
// hand-syncing is comfortable; if it grows again, generate the edge copies instead of writing an
// eighth by hand. Noted, not scheduled.
//
// Why the edge side needs them: the URL importer writes `content` straight into `prompts`, and
// `create_template` / `update_template` accept whatever a caller sends. Without these, a skill whose
// text still carries its author's header would keep it inside the body — the exact state SQEM-249
// exists to end, recreated on every write.

/** The three fields a SKILL.md header carries into a Sqemes template. */
type SkillBundle = { title: string; description: string; content: string };

/**
 * SQEM-251 — the skill's own folder name, which is also the prefix its files carry in the workspace.
 * A drift here would silently change where imported files land, and only on one of the two paths.
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


export const OWN_FRONTMATTER_KEYS = ['name', 'title', 'description'];

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

export function withoutOwnFrontmatter(content: string): string {
  const { foreign, body } = splitFrontmatter(content);
  if (!foreign.length) return body;
  return `---\n${foreign.join('\n')}\n---\n${body}`;
}

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

function deriveTitle(body: string, fallback: string): string {
  const h = body.match(/^\s*#\s+(.+?)\s*$/m);
  return h ? h[1] : fallback;
}
