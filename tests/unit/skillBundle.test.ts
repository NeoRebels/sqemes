import { describe, it, expect } from 'vitest';
import {
  buildSkillMd,
  readSkillMd,
  buildSkillZip,
  readSkillZip,
  toSlug,
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
    await expect(readSkillZip(new File([await z.generateAsync({ type: 'blob' })], 'n.zip')))
      .rejects.toThrow(/does not look like an Agent Skill/);
  });

  it('refuses to pack a context file that would overwrite the instructions', async () => {
    await expect(buildSkillZip({ ...SKILL, files: [{ name: SKILL_ENTRY, blob: blobOf('x'), mimeType: 'text/markdown' }] }))
      .rejects.toThrow(/would replace the skill's instructions/);
  });
});
