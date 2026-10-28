import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lineDiff, diffCounts, withContext } from '../../lib/lineDiff';
import { en } from './i18nText';

/**
 * SQEM-477 (b) — the History tab. The rules (who may restore or delete, what a version holds) are in the
 * database and proven in tests/isolation/templateVersions.test.ts; this pins the diff and the wiring.
 */
describe('lineDiff', () => {
  it('marks only the changed line in a long text', () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    const after = ['a', 'B', 'c', 'd'].join('\n');
    expect(lineDiff(before, after)).toEqual([
      { type: 'same', text: 'a' }, { type: 'removed', text: 'b' }, { type: 'added', text: 'B' },
      { type: 'same', text: 'c' }, { type: 'same', text: 'd' },
    ]);
  });
  it('finds insertions and deletions in the middle', () => {
    const d = lineDiff('a\nb\nc\nd', 'a\nx\nb\nd');
    expect(diffCounts(d)).toEqual({ added: 1, removed: 1 });
    expect(d.filter(l => l.type === 'same').map(l => l.text)).toEqual(['a', 'b', 'd']);
  });
  it('identical texts have no changes; an empty "before" is all added', () => {
    expect(diffCounts(lineDiff('x\ny', 'x\ny'))).toEqual({ added: 0, removed: 0 });
    expect(diffCounts(lineDiff('', 'x\ny'))).toEqual({ added: 2, removed: 1 }); // '' is one empty line
  });
  it('⛔ a huge rewrite does not freeze: it falls back to removed + added', () => {
    const a = Array.from({ length: 3000 }, (_, k) => `a${k}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, k) => `b${k}`).join('\n');
    const t = performance.now();
    expect(diffCounts(lineDiff(a, b))).toEqual({ added: 3000, removed: 3000 });
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('collapses long unchanged stretches around a change', () => {
    const lines = Array.from({ length: 20 }, (_, k) => `l${k}`);
    const rows = withContext(lineDiff(lines.join('\n'), lines.map((l, k) => (k === 10 ? 'X' : l)).join('\n')), 2);
    expect(rows[0]).toEqual({ type: 'gap', count: 8 });
    expect(rows.at(-1)).toEqual({ type: 'gap', count: 7 }); // 21 rows: the change is a removed AND an added line
  });
});

describe('SQEM-477 — the editor\'s right panel', () => {
  const editor = readFileSync('pages/TemplateEditor.tsx', 'utf8');
  const panel = readFileSync('components/VersionHistoryPanel.tsx', 'utf8');
  // SQEM-581 — Test first and the default since then; History is the second tab.
  it('has Test and History tabs for a saved workspace playbook, Test first', () => {
    expect(editor).toContain("const hasHistory = !!id && !isLibrary;");
    expect(editor).toContain("useState<'history' | 'test'>('test')");
    expect(editor).toMatch(/hasHistory && rightTab === 'history' \? \(\s*<VersionHistoryPanel/);
  });
  it('refreshes the history after every save', () => {
    expect(editor).toMatch(/setIsDirty\(false\);\s*setHistoryKey\(k => k \+ 1\);\s*};/);
  });
  it('restore and delete are offered only with the edit right, and never for the current version', () => {
    expect(panel).toContain('{canEdit && selected.id !== latest?.id && (');
  });
  it('⛔ a restore that would discard unsaved edits says so before it runs', () => {
    expect(panel).toContain('{isDirty && <p');
  });
  it('names the files a restore had to leave out', () => {
    expect(editor).toContain('txt.ed_restored_missing({ version, files: missingFiles.join');
    expect(en.ed_restored_missing).toContain('Left out because deleted: {files}'); // SQEM-605
  });
});
