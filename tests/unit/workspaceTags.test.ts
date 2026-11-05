import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { collectWorkspaceTags, withRegistry } from '../../lib/workspaceTags';
import type { Prompt, WorkspaceFile } from '../../types';

// SQEM-184 — the shared workspace tag vocabulary: union of prompt.tag + file.tags[], deduped, sorted.
const prompt = (tag: string | null): Prompt => ({ tag } as unknown as Prompt);
const file = (tags: string[]): WorkspaceFile => ({ tags } as unknown as WorkspaceFile);

describe('collectWorkspaceTags', () => {
  it('unions prompt tags and file tags', () => {
    expect(collectWorkspaceTags([prompt('sales')], [file(['legal'])])).toEqual(['legal', 'sales']);
  });

  it('dedupes across sources and sorts alphabetically', () => {
    const tags = collectWorkspaceTags([prompt('beta'), prompt('alpha')], [file(['beta', 'gamma'])]);
    expect(tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('ignores prompts without a tag and returns [] when empty', () => {
    expect(collectWorkspaceTags([prompt(null)], [file([])])).toEqual([]);
    expect(collectWorkspaceTags([], [])).toEqual([]);
  });
});

// SQEM-647 — the bulk bar offers every workspace tag: the registry plus the tags in use.
describe('withRegistry', () => {
  it('adds registry tags nobody uses yet, deduped and sorted', () => {
    expect(withRegistry(['sales'], ['marketing', 'sales'])).toEqual(['marketing', 'sales']);
  });
  it('keeps tags in use that are missing from the registry', () => {
    expect(withRegistry(['legacy'], [])).toEqual(['legacy']);
    expect(withRegistry([], undefined)).toEqual([]);
  });
});

// The three pages pass the union to the bulk bar; the filters keep the tags in use.
describe('bulk bar tag source', () => {
  for (const page of ['Templates', 'Personas', 'Files']) {
    it(`${page} offers the registry in the bulk bar, not in the filter`, () => {
      const src = readFileSync(`pages/${page}.tsx`, 'utf8');
      expect(src).toContain('addableTags={withRegistry(allTags, workspace.tags)}');
      expect(src).toContain('<TagFilter tags={allTags}');
    });
  }
});
