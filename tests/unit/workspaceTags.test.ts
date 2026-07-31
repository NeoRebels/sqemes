import { describe, it, expect } from 'vitest';
import { collectWorkspaceTags } from '../../lib/workspaceTags';
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
