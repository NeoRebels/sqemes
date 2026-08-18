import { describe, it, expect } from 'vitest';
import {
  buildSkillMd,
  commonRootDir,
  importErrorMessage,
  SkillArchiveError,
  readSkillMd,
  buildSkillZip,
  readSkillZip,
  toSlug,
  workspacePathFor,
  SKILL_ENTRY,
  type SkillBundle,
} from '../../lib/skillBundle';

// SQEM-243 — an Agent Skill has to survive the round trip, and "has to" is worth nothing unless a
// test says so. These run without network or storage, which is exactly why `buildSkillZip` and
// `readSkillZip` were separated from the workspace IO in the first place.

const blobOf = (text: string) => new Blob([text], { type: 'text/plain' });

const SKILL: SkillBundle = {
  title: 'Gesellschafter-Steuerberatung (NeoRebels GmbH)',
  description: 'Prüft Gesellschafterfragen: Ausschüttung, Verrechnungskonto, "Sperrjahr".',
  content: '# Vorgehen\n\nZuerst den Gesellschaftsvertrag lesen.\n',
  files: [
    { name: 'references/gesellschaftsvertrag.md', blob: blobOf('§1 Firma'), mimeType: 'text/markdown' },
    { name: 'scripts/berechnung.py', blob: blobOf('print(42)\n'), mimeType: 'text/x-python' },
  ],
};

describe('SKILL.md frontmatter', () => {
  it('writes name as a slug and title verbatim — a slug cannot be turned back into a title', () => {
    const md = buildSkillMd(SKILL);
    expect(md).toContain('name: gesellschafter-steuerberatung-neorebels-gmbh');
    expect(md).toContain('title: "Gesellschafter-Steuerberatung (NeoRebels GmbH)"');
  });

  it('survives colons and quotes in the description', () => {
    const back = readSkillMd(buildSkillMd(SKILL));
    expect(back.description).toBe(SKILL.description);
  });

  it('round-trips title, description and body exactly', () => {
    const back = readSkillMd(buildSkillMd(SKILL));
    expect(back).toEqual({ title: SKILL.title, description: SKILL.description, content: SKILL.content });
  });

  it('accepts a file with NO frontmatter instead of failing', () => {
    // The friction this avoids is the whole reason SQEM-236 exists: a hard failure here is what
    // sends people back to curl-ing an unpinned branch at runtime.
    const back = readSkillMd('# Video editing\n\nDo the thing.\n');
    expect(back.title).toBe('Video editing');
    expect(back.content).toBe('# Video editing\n\nDo the thing.\n');
  });

  it('falls back to the Agent-Skill slug when only `name` is present', () => {
    const back = readSkillMd('---\nname: pdf-filler\ndescription: Fills PDFs\n---\n\nBody\n');
    expect(back.title).toBe('pdf-filler');
    expect(back.description).toBe('Fills PDFs');
  });

  it('keeps a body that itself contains a --- rule', () => {
    const b = { title: 'T', description: 'D', content: 'one\n\n---\n\ntwo\n' };
    expect(readSkillMd(buildSkillMd(b)).content).toBe(b.content);
  });
});

describe('toSlug', () => {
  it('never returns empty', () => {
    expect(toSlug('   ')).toBe('skill');
    expect(toSlug('###')).toBe('skill');
  });
});

describe('the round trip', () => {
  it('export → import → export keeps SKILL.md byte-identical and every file intact', async () => {
    // The zip *container* is not compared: JSZip stamps each entry with the current time, so two
    // archives of identical content differ in bytes by design. What must not change is the content —
    // SKILL.md character for character, and every file's path and bytes.
    const first = await readSkillZip(new File([await buildSkillZip(SKILL)], 's.zip'));
    const second = await readSkillZip(new File([await buildSkillZip(first)], 's.zip'));

    expect(buildSkillMd(second)).toBe(buildSkillMd(first));
    expect(second.files.map(f => f.name).sort()).toEqual(SKILL.files.map(f => f.name).sort());

    for (const original of SKILL.files) {
      const got = second.files.find(f => f.name === original.name)!;
      expect(await got.blob.text()).toBe(await original.blob.text());
    }
  });

  it('strips a single wrapping folder, which is what zipping a directory produces', async () => {
    const zip = await buildSkillZip(SKILL);
    const { default: JSZip } = await import('jszip');
    const inner = await JSZip.loadAsync(zip);
    const wrapped = new JSZip();
    for (const [path, entry] of Object.entries(inner.files)) {
      if (!entry.dir) wrapped.file(`my-skill/${path}`, await entry.async('blob'));
    }
    const read = await readSkillZip(new File([await wrapped.generateAsync({ type: 'blob' })], 'w.zip'));
    expect(read.title).toBe(SKILL.title);
    expect(read.files.map(f => f.name).sort()).toEqual(['references/gesellschaftsvertrag.md', 'scripts/berechnung.py']);
  });

  it('drops macOS metadata instead of importing it as context files', async () => {
    const { default: JSZip } = await import('jszip');
    const z = new JSZip();
    z.file(SKILL_ENTRY, buildSkillMd(SKILL));
    z.file('notes.md', 'x');
    z.file('__MACOSX/._notes.md', 'junk');
    z.file('.DS_Store', 'junk');
    const read = await readSkillZip(new File([await z.generateAsync({ type: 'blob' })], 'm.zip'));
    expect(read.files.map(f => f.name)).toEqual(['notes.md']);
  });

  it('refuses an archive without SKILL.md rather than importing something else', async () => {
    const { default: JSZip } = await import('jszip');
    const z = new JSZip();
    z.file('readme.md', 'not a skill');
    // SQEM-250 — the wording is now the shared rule's, so both import paths say the same thing
    // about the same archive. `kind: 'none'` is what lets the UI mention the bundle format too.
    await expect(readSkillZip(new File([await z.generateAsync({ type: 'blob' })], 'n.zip')))
      .rejects.toMatchObject({ kind: 'none', message: expect.stringContaining('an Agent Skill is a folder') });
  });

  it('refuses to pack a context file that would overwrite the instructions', async () => {
    await expect(buildSkillZip({ ...SKILL, files: [{ name: SKILL_ENTRY, blob: blobOf('x'), mimeType: 'text/markdown' }] }))
      .rejects.toThrow(/would replace the skill's instructions/);
  });
});

// SQEM-251 — inside a skill a path is skill-relative; in the workspace it is not. `workspace_files`
// is one flat namespace per workspace, with no unique constraint on the name, and the Files page
// groups by prefix. Storing the skill-relative path directly meant the second imported skill merged
// its folders into the first one's — no name collision required.

describe('workspacePathFor', () => {
  it('puts two skills in two folders, even when their files are named identically', () => {
    // The failure this exists to prevent. `references/style-guide.md` is a *conventional* name, so
    // two skills carrying it is the expected case, not the unlucky one.
    const a = workspacePathFor('Diagram Design', 'references/style-guide.md');
    const b = workspacePathFor('Tax Advice', 'references/style-guide.md');
    expect(a).toBe('diagram-design/references/style-guide.md');
    expect(b).toBe('tax-advice/references/style-guide.md');
    expect(a).not.toBe(b);
  });

  it('uses the same slug the frontmatter writes, so the folder and the skill agree', () => {
    expect(workspacePathFor(SKILL.title, 'a.md').split('/')[0]).toBe(toSlug(SKILL.title));
  });

  it('normalises the path it is given rather than trusting it', () => {
    expect(workspacePathFor('S', './refs//a.md')).toBe('s/refs/a.md');
  });
});

describe('commonRootDir — the rule export and import share', () => {
  it('finds the folder every file sits under, which is what export strips', () => {
    expect(commonRootDir(['diagram-design/references/a.md', 'diagram-design/scripts/b.py']))
      .toBe('diagram-design');
  });

  it('returns nothing when a file was attached later and shares no root', () => {
    // Deliberate: nothing is stripped, and that file exports beside the folder where a person can
    // see it. Guessing on its behalf would be the worse answer.
    expect(commonRootDir(['diagram-design/references/a.md', 'Vertrag 2026.pdf'])).toBe('');
  });

  it('returns nothing for a file at the root, and does not crash on an empty list', () => {
    expect(commonRootDir(['SKILL.md'])).toBe('');
    expect(commonRootDir([])).toBe('');
  });

  it('is the inverse of workspacePathFor for a whole skill', () => {
    const stored = SKILL.files.map(f => workspacePathFor(SKILL.title, f.name));
    const root = commonRootDir(stored);
    expect(stored.map(n => n.slice(root.length + 1))).toEqual(SKILL.files.map(f => f.name));
  });
});

// SQEM-250 — the import a person actually performs: they find a skill on GitHub, press "Download
// ZIP", and get the whole repository with the skill somewhere inside it. The old reader stripped
// exactly one wrapper and then looked at the root, so it missed — and the screen said
// "manifest.json missing", which reads as "skill import was never built".

const repoZip = async (extra: Record<string, string> = {}) => {
  const { default: JSZip } = await import('jszip');
  const z = new JSZip();
  z.file('diagram-design-main/README.md', '# The repo');
  z.file('diagram-design-main/LICENSE', 'MIT');
  z.file('diagram-design-main/docs/adr/0001-something.md', 'a decision');
  z.file('diagram-design-main/skills/diagram-design/SKILL.md', buildSkillMd(SKILL));
  z.file('diagram-design-main/skills/diagram-design/references/type-bar.md', 'bars');
  z.file('diagram-design-main/skills/diagram-design/scripts/self_check.py', 'print(1)');
  for (const [k, v] of Object.entries(extra)) z.file(k, v);
  return new File([await z.generateAsync({ type: 'blob' })], 'repo.zip');
};

describe('a GitHub repository zip', () => {
  it('imports the skill from any depth, without anyone repacking it first', async () => {
    const read = await readSkillZip(await repoZip());
    expect(read.title).toBe(SKILL.title);
    expect(read.files.map(f => f.name).sort()).toEqual(['references/type-bar.md', 'scripts/self_check.py']);
  });

  it('leaves the rest of the repository out — README, LICENSE and docs are not context files', async () => {
    // Importing them would be worse than the bug being fixed: someone else's repository would
    // arrive attached to your skill.
    const read = await readSkillZip(await repoZip());
    expect(read.files.map(f => f.name).join(' ')).not.toMatch(/README|LICENSE|adr/);
  });

  it('falls back to the skill folder name for a title, not the repository name', async () => {
    const { default: JSZip } = await import('jszip');
    const z = new JSZip();
    z.file('repo-main/skills/my-skill/SKILL.md', 'no frontmatter here');
    const read = await readSkillZip(new File([await z.generateAsync({ type: 'blob' })], 'r.zip'));
    expect(read.title).toBe('my-skill');
  });

  it('refuses to choose when the repository holds several skills', async () => {
    const file = await repoZip({ 'diagram-design-main/skills/other/SKILL.md': buildSkillMd(SKILL) });
    await expect(readSkillZip(file)).rejects.toMatchObject({ kind: 'ambiguous' });
  });

  it('still handles the one-wrapper case SQEM-243 was built for', async () => {
    const { default: JSZip } = await import('jszip');
    const z = new JSZip();
    z.file('my-skill/SKILL.md', buildSkillMd(SKILL));
    z.file('my-skill/notes.md', 'x');
    const read = await readSkillZip(new File([await z.generateAsync({ type: 'blob' })], 'w.zip'));
    expect(read.files.map(f => f.name)).toEqual(['notes.md']);
  });
});

describe('importErrorMessage — the file decides which error is shown', () => {
  const bundleErr = new Error('Not a Sqemes bundle (manifest.json missing)');

  it('names both formats only when the archive is genuinely neither', () => {
    const msg = importErrorMessage(bundleErr, new SkillArchiveError('No SKILL.md …', 'none'));
    expect(msg).toContain('SKILL.md');
    expect(msg).toContain('manifest.json');
  });

  it('does NOT mention manifest.json when the file is a skill archive with a problem', () => {
    // The whole point. A repo zip carrying a good SKILL.md used to be reported as a broken bundle.
    const msg = importErrorMessage(bundleErr, new SkillArchiveError('This skill has 900 files …', 'too-many'));
    expect(msg).not.toContain('manifest.json');
    expect(msg).toContain('900 files');
  });

  it('rebuilds the ambiguous case instead of passing the shared sentence through', () => {
    // The shared rule says `Name one with "path"` — true over MCP, meaningless at a file picker.
    const msg = importErrorMessage(bundleErr, new SkillArchiveError('… "path": a, b', 'ambiguous', ['skills/a', 'skills/b']));
    expect(msg).not.toContain('path');
    expect(msg).toContain('skills/a, skills/b');
    expect(msg).toMatch(/Zip just the one/);
  });

  it('falls back to the bundle error for a failure that is not ours to classify', () => {
    expect(importErrorMessage(bundleErr, new Error('boom'))).toContain('manifest.json');
  });
});
