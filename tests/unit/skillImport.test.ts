import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALLOWED_ARCHIVE_HOSTS,
  findSkillRoot,
  isAllowedArchiveHost,
  resolveArchiveUrl,
} from '../../supabase/functions/_shared/skillArchive';

// SQEM-248 — the two decisions the URL importer makes before it touches anything: which URL it is
// willing to download, and which folder in the archive is the skill. Both are pure, so they are
// tested here rather than against a live GitHub.

describe('resolveArchiveUrl', () => {
  it('takes a repository URL and asks for the default branch, without guessing its name', () => {
    // `main` vs `master` is exactly the guess that fails on the older repositories most likely to
    // hold a skill worth importing. `zipball` with no ref makes GitHub answer it.
    expect(resolveArchiveUrl('https://github.com/cathrynlavery/diagram-design')).toEqual({
      archiveUrl: 'https://api.github.com/repos/cathrynlavery/diagram-design/zipball',
      subPath: null,
    });
  });

  it('reads a folder link as ref plus path', () => {
    expect(resolveArchiveUrl('https://github.com/o/r/tree/main/skills/diagram-design')).toEqual({
      archiveUrl: 'https://api.github.com/repos/o/r/zipball/main',
      subPath: 'skills/diagram-design',
    });
  });

  it('strips a .git suffix — that is what a clone URL looks like', () => {
    expect(resolveArchiveUrl('https://github.com/o/r.git').archiveUrl)
      .toBe('https://api.github.com/repos/o/r/zipball');
  });

  it('accepts a direct .zip on an allowed host', () => {
    const url = 'https://codeload.github.com/o/r/zip/refs/heads/main.zip';
    expect(resolveArchiveUrl(url)).toEqual({ archiveUrl: url, subPath: null });
  });

  it('refuses plain http, so a redirect is not the first thing that decides', () => {
    expect(() => resolveArchiveUrl('http://github.com/o/r')).toThrow(/https/i);
  });

  it('refuses a host that is not on the list — this is the SSRF containment', () => {
    expect(() => resolveArchiveUrl('https://example.com/skill.zip')).toThrow(/example\.com/);
  });

  it('refuses the loopback and link-local addresses an SSRF would aim at', () => {
    expect(() => resolveArchiveUrl('https://127.0.0.1/skill.zip')).toThrow(/Refusing/);
    expect(() => resolveArchiveUrl('https://169.254.169.254/latest/meta-data/')).toThrow(/Refusing/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => resolveArchiveUrl('not a url')).toThrow(/Not a URL/);
  });

  it('refuses an allowed host that is not pointing at an archive', () => {
    expect(() => resolveArchiveUrl('https://api.github.com/repos/o/r/issues')).toThrow(/not a \.zip/i);
  });

  it('names what it accepts when a GitHub URL is neither a repo nor a tree', () => {
    expect(() => resolveArchiveUrl('https://github.com/o/r/blob/main/SKILL.md')).toThrow(/repository/i);
  });
});

describe('isAllowedArchiveHost', () => {
  it('carries every host one GitHub download passes through', () => {
    // Dropping any of these breaks the redirect chain halfway, which reads as a network fault
    // instead of a refusal.
    for (const host of ['github.com', 'api.github.com', 'codeload.github.com', 'objects.githubusercontent.com']) {
      expect(ALLOWED_ARCHIVE_HOSTS).toContain(host);
      expect(isAllowedArchiveHost(host)).toBe(true);
    }
  });

  it('is case-insensitive, because a URL host is', () => {
    expect(isAllowedArchiveHost('GitHub.com')).toBe(true);
  });

  it('does not match a lookalike host that merely ends the same way', () => {
    expect(isAllowedArchiveHost('evil-github.com')).toBe(false);
    expect(isAllowedArchiveHost('github.com.evil.net')).toBe(false);
  });
});

describe('findSkillRoot', () => {
  // What a GitHub zipball of the real skill looks like: everything under one wrapper directory.
  const wrapped = [
    'cathrynlavery-diagram-design-9f2a1c/README.md',
    'cathrynlavery-diagram-design-9f2a1c/skills/diagram-design/SKILL.md',
    'cathrynlavery-diagram-design-9f2a1c/skills/diagram-design/references/type-bar.md',
    'cathrynlavery-diagram-design-9f2a1c/skills/diagram-design/scripts/self_check.py',
  ];

  it('finds the skill under the archive wrapper without knowing the wrapper name', () => {
    expect(findSkillRoot(wrapped)).toBe('cathrynlavery-diagram-design-9f2a1c/skills/diagram-design/');
  });

  it('handles a SKILL.md at the archive root', () => {
    expect(findSkillRoot(['SKILL.md', 'references/a.md'])).toBe('');
  });

  it('ignores what a Mac packed in', () => {
    expect(findSkillRoot(['__MACOSX/SKILL.md', 'my-skill/SKILL.md', 'my-skill/.DS_Store']))
      .toBe('my-skill/');
  });

  it('refuses to choose when the archive holds several skills', () => {
    // Picking the first would import something nobody asked for and say nothing about it — the
    // silent-partial failure this whole ticket exists to end.
    expect(() => findSkillRoot(['r/skills/a/SKILL.md', 'r/skills/b/SKILL.md']))
      .toThrow(/holds 2 skills/);
  });

  it('takes the named folder when there are several', () => {
    expect(findSkillRoot(['r/skills/a/SKILL.md', 'r/skills/b/SKILL.md'], 'skills/b'))
      .toBe('r/skills/b/');
  });

  it('tolerates surrounding slashes on the named folder', () => {
    expect(findSkillRoot(['r/skills/a/SKILL.md', 'r/skills/b/SKILL.md'], '/skills/b/'))
      .toBe('r/skills/b/');
  });

  it('says so when the named folder holds no SKILL.md', () => {
    expect(() => findSkillRoot(['r/skills/a/SKILL.md'], 'skills/nope')).toThrow(/No SKILL\.md under "skills\/nope"/);
  });

  it('says so when the archive is not a skill at all', () => {
    expect(() => findSkillRoot(['r/README.md', 'r/index.js'])).toThrow(/an Agent Skill is a folder/i);
  });

  it('does not mistake a file merely ending in the name', () => {
    expect(() => findSkillRoot(['r/NOT-SKILL.md'])).toThrow(/No SKILL\.md/);
  });
});

describe('the two frontmatter readers agree', () => {
  // SQEM-248, same arrangement as lib/storageKey.ts ↔ _shared/storageKey.ts (SQEM-237). The edge
  // functions and the browser bundle share no module system, so `readSkillMd` exists twice. That is
  // acceptable only while something fails when the copies drift — this is that something.
  //
  // If this goes red: fix the copy, do not relax the test.
  const bodyOf = (path: string, pattern: RegExp): string => {
    const src = readFileSync(resolve(__dirname, '../..', path), 'utf8');
    const match = src.match(pattern);
    if (!match) throw new Error(`Not found in ${path} — did its signature change?`);
    return match[1].replace(/\s+/g, ' ').trim();
  };

  const BROWSER = 'lib/skillBundle.ts';
  const EDGE = 'supabase/functions/_shared/skillMd.ts';
  // findSkillRoot/isArchiveJunk live in the archive module on the edge side, skillBundle on ours.
  const edgeFor = (name: string) => (['findSkillRoot', 'isArchiveJunk'].includes(name)
    ? 'supabase/functions/_shared/skillArchive.ts' : EDGE);

  const shapes: [string, RegExp][] = [
    ['readSkillMd', /export function readSkillMd\(md: string, fallbackTitle = 'Imported skill'\): Pick<SkillBundle, 'title' \| 'description' \| 'content'> \{([\s\S]*?)\n\}/],
    ['deriveTitle', /function deriveTitle\(body: string, fallback: string\): string \{([\s\S]*?)\n\}/],
    ['yamlUnquote', /const yamlUnquote = \(v: string\) => \{([\s\S]*?)\n\};/],
    // SQEM-251 — the skill's folder name. A drift here would silently change where imported files
    // land, and only on one of the two import paths, which is the worst shape a bug can have.
    ['toSlug', /export function toSlug\(title: string\): string \{([\s\S]*?)\n\}/],
    // SQEM-250 — the rule that decides WHICH folder is the skill. Both import paths must agree
    // about the same archive, or a repo zip imports over MCP and is refused at the file picker.
    ['findSkillRoot', /export function findSkillRoot\(paths: string\[\], subPath\?: string \| null\): string \{([\s\S]*?)\n\}/],
    ['isArchiveJunk', /export function isArchiveJunk\(path: string\): boolean \{([\s\S]*?)\n\}/],
  ];

  for (const [name, pattern] of shapes) {
    it(`${name} is identical in both copies`, () => {
      expect(bodyOf(BROWSER, pattern)).toBe(bodyOf(edgeFor(name), pattern));
    });

    it(`${name} is not empty, so a failed match cannot pass as agreement`, () => {
      expect(bodyOf(BROWSER, pattern).length).toBeGreaterThan(20);
    });
  }
});

describe('what the importer sends to storage is what the bucket accepts', () => {
  // SQEM-248 — this exact mismatch failed the first real import: the skill's 107 `.html` files were
  // handed to storage as `text/html`, which the bucket refuses. `TEXT_MIME` (thirty-odd types) is
  // what the *row* records; the bucket allowlist is short, and text goes in as `text/plain`.
  // Reading both files keeps the two from drifting again, since neither can see the other.
  const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

  const bucketAllowlist = (): string[] => {
    const sql = read('supabase/migrations/20260617000000_workspace_files.sql');
    const m = sql.match(/array\[([^\]]*)\]/);
    if (!m) throw new Error('bucket allowlist not found — did the migration change?');
    return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  };

  const sentToStorage = (): string[] => {
    const src = read('supabase/functions/mcp-server/index.ts');
    const text = src.match(/const STORAGE_TEXT_MIME = '([^']+)';/);
    const binary = src.match(/const BINARY_EXT_MIME: Record<string, string> = \{([\s\S]*?)\n\};/);
    if (!text || !binary) throw new Error('constants not found — did they get renamed?');
    return [text[1], ...[...binary[1].matchAll(/'([^']+)'/g)].map(m => m[1])];
  };

  it('every content type the import can upload is in the bucket allowlist', () => {
    const allowed = bucketAllowlist();
    for (const mime of sentToStorage()) expect(allowed).toContain(mime);
  });

  it('and the allowlist was actually parsed, so an empty match cannot pass', () => {
    expect(bucketAllowlist().length).toBeGreaterThan(3);
    expect(sentToStorage().length).toBeGreaterThan(3);
  });
});
