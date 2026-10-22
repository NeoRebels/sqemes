// SQEM-477 — a line diff for the version history. Written here rather than taken from a package: it is
// ~60 lines, and a dependency would need a licence review and would ship in the self-host SBOM.
//
// Common prefix and suffix are stripped first (most edits touch a few lines of a long playbook), then
// the middle is diffed by longest common subsequence. Past MAX_CELLS the middle is shown as removed +
// added instead — correct, just less precise — so a pathological pair cannot freeze the tab.

export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const head: DiffLine[] = a.slice(0, start).map(text => ({ type: 'same', text }));
  const tail: DiffLine[] = a.slice(endA).map(text => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_CELLS) {
    return [
      ...head,
      ...midA.map(text => ({ type: 'removed' as const, text })),
      ...midB.map(text => ({ type: 'added' as const, text })),
      ...tail,
    ];
  }

  // lcs[i][j] = length of the LCS of midA[i..] and midB[j..], one flat array.
  const n = midA.length, m = midB.length, w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) { mid.push({ type: 'same', text: midA[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) { mid.push({ type: 'removed', text: midA[i] }); i++; }
    else { mid.push({ type: 'added', text: midB[j] }); j++; }
  }
  while (i < n) mid.push({ type: 'removed', text: midA[i++] });
  while (j < m) mid.push({ type: 'added', text: midB[j++] });
  return [...head, ...mid, ...tail];
}

/** Lines changed in a diff, for a one-line summary ("+3 −1"). */
export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of lines) { if (l.type === 'added') added++; else if (l.type === 'removed') removed++; }
  return { added, removed };
}

/**
 * Collapse long unchanged stretches, keeping `context` lines around each change. A 600-line skill with
 * one edited sentence should show that sentence, not 600 lines.
 */
export type DiffRow = DiffLine | { type: 'gap'; count: number };
export function withContext(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, k) => {
    if (l.type === 'same') return;
    for (let d = Math.max(0, k - context); d <= Math.min(lines.length - 1, k + context); d++) keep[d] = true;
  });
  const out: DiffRow[] = [];
  let skipped = 0;
  lines.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) { out.push({ type: 'gap', count: skipped }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'gap', count: skipped });
  return out;
}
