import { describe, it, expect } from 'vitest';
import { planTagChange, tagChangeSummary, tagsOnSelection } from '../../lib/fileTags';

// SQEM-253 — the two cases a bulk tag action gets wrong if nobody thinks about them: a selection
// where the tag is already on some files, and a run where some writes fail. Both are decided here
// rather than in the component, which is what makes them testable at all.

const FILES = [
  { id: 'a', tags: ['legal'] },
  { id: 'b', tags: [] },
  { id: 'c', tags: ['legal', 'draft'] },
  { id: 'd', tags: ['draft'] },
];
const sel = (...ids: string[]) => new Set(ids);

describe('planTagChange', () => {
  it('touches only the files that would actually change — a mixed selection is not a special case', () => {
    // a and c already have "legal"; only b needs writing. Nothing to ask the user about.
    const plan = planTagChange(FILES, sel('a', 'b', 'c'), 'legal', 'add');
    expect(plan).toEqual([{ id: 'b', tags: ['legal'] }]);
  });

  it('returns an empty plan when the selection already looks as asked', () => {
    expect(planTagChange(FILES, sel('a', 'c'), 'legal', 'add')).toEqual([]);
  });

  it('removes only where the tag is present, and keeps the other tags', () => {
    const plan = planTagChange(FILES, sel('a', 'b', 'c'), 'legal', 'remove');
    expect(plan).toEqual([{ id: 'a', tags: [] }, { id: 'c', tags: ['draft'] }]);
  });

  it('ignores files that are not selected', () => {
    expect(planTagChange(FILES, sel('b'), 'legal', 'add').map(p => p.id)).toEqual(['b']);
  });

  it('does not mutate the file it planned from', () => {
    const files = [{ id: 'x', tags: ['keep'] }];
    planTagChange(files, sel('x'), 'new', 'add');
    expect(files[0].tags).toEqual(['keep']);
  });
});

describe('tagsOnSelection', () => {
  it('offers exactly the tags the selection actually carries', () => {
    // Nothing else may be offered for removal, or the control no-ops and looks broken.
    expect(tagsOnSelection(FILES, sel('a', 'b'))).toEqual(['legal']);
    expect(tagsOnSelection(FILES, sel('c', 'd'))).toEqual(['draft', 'legal']);
  });

  it('is empty when nothing is selected or nothing is tagged', () => {
    expect(tagsOnSelection(FILES, sel())).toEqual([]);
    expect(tagsOnSelection(FILES, sel('b'))).toEqual([]);
  });
});

describe('tagChangeSummary', () => {
  it('names both numbers on a partial failure — "7 of 10" is actionable, "something failed" is not', () => {
    const { text, ok } = tagChangeSummary(7, 10, 'legal', 'add');
    expect(ok).toBe(false);
    expect(text).toContain('7 of 10');
    expect(text).toMatch(/stay selected/);
  });

  it('reports a clean run as success', () => {
    expect(tagChangeSummary(3, 3, 'legal', 'add')).toEqual({ text: 'Added “legal” to 3 files.', ok: true });
    expect(tagChangeSummary(1, 1, 'legal', 'remove')).toEqual({ text: 'Removed “legal” from 1 file.', ok: true });
  });

  it('treats "nothing to do" as success, not as an error', () => {
    // An empty plan means the selection already looks the way it was asked to look.
    const { ok, text } = tagChangeSummary(0, 0, 'legal', 'add');
    expect(ok).toBe(true);
    expect(text).toMatch(/already has/);
  });
});
