import { describe, it, expect } from 'vitest';
import { folderOf, baseNameOf, hasFolders, groupByFolder } from '../../lib/filePaths';

// SQEM-244 — the tree is an interpretation of `name` at render time, so the interpretation is what
// needs testing. Nothing here touches storage; that is the point (SQEM-243's lesson).

describe('folderOf / baseNameOf', () => {
  it('splits at the LAST slash, so nested folders survive', () => {
    expect(folderOf('scripts/a/b.py')).toBe('scripts/a');
    expect(baseNameOf('scripts/a/b.py')).toBe('b.py');
  });

  it('treats a name without a slash as living at the root', () => {
    expect(folderOf('notes.md')).toBe('');
    expect(baseNameOf('notes.md')).toBe('notes.md');
  });

  it('does not mistake a dot for a separator', () => {
    expect(folderOf('v1.2.3-notes.md')).toBe('');
  });
});

describe('hasFolders', () => {
  it('is false for a flat shelf — an empty hierarchy is worse than none', () => {
    expect(hasFolders([{ name: 'a.md' }, { name: 'b.pdf' }])).toBe(false);
  });

  it('is true as soon as one file carries a path', () => {
    expect(hasFolders([{ name: 'a.md' }, { name: 'scripts/b.py' }])).toBe(true);
  });
});

describe('groupByFolder', () => {
  const files = [
    { name: 'scripts/run.py' },
    { name: 'readme.md' },
    { name: 'references/contract.pdf' },
    { name: 'scripts/helper.py' },
  ];

  it('puts root files first, then folders alphabetically', () => {
    expect(groupByFolder(files).map(g => g.folder)).toEqual(['', 'references', 'scripts']);
  });

  it('keeps the caller’s order inside a group', () => {
    // The page sorts by date / size / usage; a grouping that re-sorted would silently override it.
    const scripts = groupByFolder(files).find(g => g.folder === 'scripts')!;
    expect(scripts.files.map(f => f.name)).toEqual(['scripts/run.py', 'scripts/helper.py']);
  });

  it('loses nothing — every file lands in exactly one group', () => {
    const grouped = groupByFolder(files).flatMap(g => g.files);
    expect(grouped).toHaveLength(files.length);
    expect(new Set(grouped.map(f => f.name)).size).toBe(files.length);
  });

  it('returns a single root group when nothing has a path', () => {
    expect(groupByFolder([{ name: 'a.md' }])).toEqual([{ folder: '', files: [{ name: 'a.md' }] }]);
  });
});
