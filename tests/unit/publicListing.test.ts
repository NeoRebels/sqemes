import { describe, it, expect } from 'vitest';
import { publicListingIdFromHash } from '../../lib/publicRoutes';
import { canDownloadAsSkill, listingToSkillZip } from '../../lib/listingSkillZip';
import { readSkillZip } from '../../lib/skillBundle';
import type { LibraryTemplate } from '../../types';

// SQEM-258 — the two rules worth pinning: which URL skips the auth gate, and what a listing turns
// into when someone downloads it as an Agent Skill.

const ID = '5471ce62-3f92-4dc9-b4d5-7030a58e91ce';

describe('publicListingIdFromHash — what renders before the sign-in screen', () => {
  it('lets a listing through', () => {
    expect(publicListingIdFromHash(`#/library/${ID}`)).toBe(ID);
  });

  it('lets a listing with a query string through', () => {
    expect(publicListingIdFromHash(`#/library/${ID}?ref=slack`)).toBe(ID);
  });

  it('does NOT let the editor through', () => {
    // The whole reason the pattern is narrow: /edit is the marketplace admin surface. A loose match
    // here would hand it to a stranger.
    expect(publicListingIdFromHash(`#/library/${ID}/edit`)).toBeNull();
    expect(publicListingIdFromHash('#/library/new')).toBeNull();
  });

  it('does not let anything else through', () => {
    for (const hash of ['#/library', '#/templates', '#/settings', '#/', '', '#/library/not-a-uuid',
                        `#/library/${ID}/`, `#/prompts/${ID}`]) {
      expect(publicListingIdFromHash(hash)).toBeNull();
    }
  });
});

describe('canDownloadAsSkill', () => {
  it('is a skill-only offer — a prompt or assistant would lose half of itself', () => {
    expect(canDownloadAsSkill({ kind: 'skill' } as LibraryTemplate)).toBe(true);
    expect(canDownloadAsSkill({ kind: 'prompt' } as LibraryTemplate)).toBe(false);
    expect(canDownloadAsSkill({ kind: 'assistant' } as LibraryTemplate)).toBe(false);
  });
});

const LISTING = {
  kind: 'skill', title: 'Diagram Design', description: 'Draws things.', content: '# Body\n',
} as LibraryTemplate;

// The schema string is written out rather than imported, and that is the point: bundles already
// sit in `library-files` under **v1**, so this test asserts that a v1 bundle still converts. Importing
// the constant would make the test follow a schema bump silently instead of failing on it.
const BUNDLE_SCHEMA = 'sqemes-bundle/v1';

/** A `.sqemes.zip` as the marketplace stores one, built by hand so the test pins the contract. */
const bundleBlob = async (opts: { files: { ref: string; name: string; body: string }[]; refs?: string[]; content?: string; drop?: string }) => {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const files = opts.files.map(f => ({ ref: f.ref, name: f.name, mimeType: 'text/markdown', sizeBytes: f.body.length, path: `files/${f.ref}__${f.name}` }));
  for (const f of opts.files) if (f.ref !== opts.drop) zip.file(`files/${f.ref}__${f.name}`, f.body);
  zip.file('manifest.json', JSON.stringify({
    schema: BUNDLE_SCHEMA,
    templates: [{ ref: 't1', kind: 'skill', title: 'Bundle title', description: 'Bundle description',
                  content: opts.content ?? '# From the bundle\n', variables: [], tag: null,
                  contextFileRefs: opts.refs ?? files.map(f => f.ref), skillRefs: [] }],
    skills: [], files,
  }));
  return zip.generateAsync({ type: 'blob' });
};

describe('listingToSkillZip', () => {
  it('a curated listing (no bundle) becomes a valid skill folder with just SKILL.md', async () => {
    // 21 of the 22 production listings are this case.
    const zip = await listingToSkillZip(LISTING, null);
    const read = await readSkillZip(new File([zip], 's.zip'));
    expect(read.title).toBe('Diagram Design');
    expect(read.description).toBe('Draws things.');
    expect(read.files).toEqual([]);
  });

  it('carries the bundle files across, under their own names', async () => {
    const blob = await bundleBlob({ files: [{ ref: 'f1', name: 'guide.md', body: 'howto' }] });
    const read = await readSkillZip(new File([await listingToSkillZip(LISTING, blob)], 's.zip'));
    expect(read.files.map(f => f.name)).toEqual(['guide.md']);
    expect(await read.files[0].blob.text()).toBe('howto');
  });

  it("the listing's title and description win over the bundle's", async () => {
    // The listing is what the reader saw on the page, and it can be renamed after publishing.
    const blob = await bundleBlob({ files: [] });
    const read = await readSkillZip(new File([await listingToSkillZip(LISTING, blob)], 's.zip'));
    expect(read.title).toBe('Diagram Design');
    expect(read.description).toBe('Draws things.');
    expect(read.content).toContain('From the bundle'); // the body does come from the bundle
  });

  it('takes only the primary template’s files, not every file in the bundle', async () => {
    // A bundle can carry an embedded skill's files too; those are not part of *this* folder.
    const blob = await bundleBlob({
      files: [{ ref: 'f1', name: 'mine.md', body: 'a' }, { ref: 'f2', name: 'someone-elses.md', body: 'b' }],
      refs: ['f1'],
    });
    const read = await readSkillZip(new File([await listingToSkillZip(LISTING, blob)], 's.zip'));
    expect(read.files.map(f => f.name)).toEqual(['mine.md']);
  });

  it('exports the rest when a bundle lost a file, rather than nothing', async () => {
    const blob = await bundleBlob({
      files: [{ ref: 'f1', name: 'here.md', body: 'a' }, { ref: 'f2', name: 'gone.md', body: 'b' }],
      drop: 'f2',
    });
    const read = await readSkillZip(new File([await listingToSkillZip(LISTING, blob)], 's.zip'));
    expect(read.files.map(f => f.name)).toEqual(['here.md']);
  });
});
