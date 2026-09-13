import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-380 — a pointer to a pruned document is a dead link in the public repo.
 *
 * ⛔ **This was a command in `AGENTS.md` that somebody ran by hand before a self-host cut, and it
 * found something on SIX consecutive cuts — v1.11.3, .4, .6, .8, .11, .12. A hundred percent.** At
 * v1.11.12 all five hits were comments written the same day by somebody who knew the rule and had
 * quoted it twice in the same session. The knowledge was never the problem.
 *
 * ⭐ **The argument for turning it into a test is evidence from that same day, not preference.** The
 * `SELF_HOSTING.md` version pin had gone stale on four consecutive cuts under a written rule;
 * SQEM-368 made it `tests/unit/selfHostingPin.test.ts`, and at v1.11.12 it could not go stale. Every
 * rule that held that day was enforced by a machine. Every rule that broke was one somebody had to
 * remember.
 *
 * ⚠️ **A test rather than a CI step**, deliberately: a CI step complains on push, a test runs on every
 * `npm test` — while the comment is still being written. And a new CI *job* would be a status check
 * branch protection does not know about, so it would be advisory and therefore useless (the SQEM-363
 * trap).
 *
 * ⛔ **This catches half the export rule and does not pretend otherwise.** A dead pointer is
 * greppable; internal framing — "the Cloud project", "production", "the owner decided" — is not. That
 * half is still a matter of paying attention, and no test here will change it.
 *
 * ⛔ **Deliberately NOT added to the public repo's CI or the extension's** (`AGENTS.md` → Twins). In
 * the exported repo the pruned files do not exist, so this check is green by construction — the rare
 * case where the rule about changing all three CI workflows together does not apply.
 */

const ROOT = resolve(__dirname, '../../');

/** Documents the export removes, and which therefore must not be pointed at from an exported file. */
const PRUNED_DOC_PATTERN = /pm\/[A-Z_]+\.md|CLAUDE\.md|AGENTS\.md|docs\/ai\//;

/**
 * ⚠️ **The phrase is subtracted LINE BY LINE, and that is not a detail.** Wrap
 * `in the source repository` onto the line after the path it qualifies and the check reports the
 * correctly-fixed pointer as a finding. That happened twice at the v1.11.8 cut, on two pointers that
 * had just been repaired properly.
 *
 * ⛔ **Reflow the comment; never widen this to span lines.** A filter loose enough to match across a
 * line break would also swallow a genuinely dead pointer that happens to sit near a good one.
 */
const LOCALISED = 'in the source repository';

/**
 * ⚠️ `.gitignore` lists `!AGENTS.md` and would be a permanent false positive.
 *
 * ⛔ It is excluded because **a check that is never clean is a check people learn to skim.** One
 * standing hit is enough to turn "clean" into "the usual", and then the seventh real finding is read
 * as noise.
 */
const ALWAYS_EXCLUDED = new Set([
  '.gitignore',
  /**
   * ⚠️ **This file, and the reason is not convenience.** It is the one place where the pruned paths
   * appear as *subject matter* rather than as pointers — the pattern itself, the assertion that the
   * prune list was parsed, the failure message telling you how to localise. The grep cannot tell the
   * difference between naming a path and sending somebody to it.
   *
   * ⛔ Same category as `.gitignore`, and it is stated here rather than filtered quietly, because a
   * self-exempting check is exactly the kind of thing that should have to justify itself.
   */
  'tests/unit/prunedReferences.test.ts',
]);

/**
 * ⭐ **The prune list is READ from the export script, never copied.**
 *
 * Copying it would make this file and `scripts/build-public-export.sh` twins over the one list whose
 * disagreement is invisible: the test would keep passing while checking the wrong set of files. Add a
 * path to the script's `rm -rf` and this test starts covering it with no second edit.
 */
function prunedPathsFromExportScript(): string[] {
  const script = readFileSync(resolve(ROOT, 'scripts/build-public-export.sh'), 'utf8');
  const block = script.match(/# 3\. Prune[\s\S]*?rm -rf \\\n([\s\S]*?)\n#/);
  if (!block) throw new Error('The prune block in scripts/build-public-export.sh could not be read — did its shape change?');

  return block[1]
    .split('\n')
    .map(line => line.replace(/\\$/, '').trim())
    .filter(Boolean)
    .flatMap(line => line.split(/\s+/));
}

/** The files that actually ship. `.gitignore`d paths are out by construction — git decides, not us. */
function exportedFiles(prunedPaths: string[]): string[] {
  // ⛔ `--others --exclude-standard` as well as the index, and that is not thoroughness for its own
  // sake: a plain `git ls-files` misses a file that is written but not yet added — which is exactly
  // when a comment gets written. This test's own first run was green for that reason, and the five
  // dead pointers it was blind to were inside itself.
  const tracked = execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  return tracked.filter(file => {
    if (ALWAYS_EXCLUDED.has(file)) return false;
    // A pruned entry is either the file itself or a directory prefix of it.
    return !prunedPaths.some(p => file === p || file.startsWith(`${p}/`));
  });
}

function deadPointers(): string[] {
  const pruned = prunedPathsFromExportScript();
  const hits: string[] = [];

  for (const file of exportedFiles(pruned)) {
    let content: string;
    try {
      content = readFileSync(resolve(ROOT, file), 'utf8');
    } catch {
      continue; // binary, or deleted but still indexed — neither can carry a pointer
    }
    if (!PRUNED_DOC_PATTERN.test(content)) continue;

    content.split('\n').forEach((line, i) => {
      if (!PRUNED_DOC_PATTERN.test(line)) return;
      if (line.includes(LOCALISED)) return;
      hits.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits;
}

describe('SQEM-380 — nothing exported points at a document the export removes', () => {
  it('reads the prune list from the export script rather than keeping its own', () => {
    // If this ever fails, the script's shape changed and the test above is silently checking the
    // wrong file set — which is the one failure mode a copied list would have hidden.
    const pruned = prunedPathsFromExportScript();
    expect(pruned).toContain('pm');
    expect(pruned).toContain('AGENTS.md');
    expect(pruned).toContain('docs/ai');
    expect(pruned).toContain('supabase/functions/_shared/injectionScan.ts');
  });

  it('⛔ no exported file points at a pruned document', () => {
    const hits = deadPointers();
    expect(
      hits,
      `Dead pointers in files that ship to the public repo. A self-hoster's checkout never had these `
      + `documents.\n\n${hits.join('\n')}\n\n`
      + `Fix by LOCALISING, never by deleting the pointer — it records where the reasoning lives:\n`
      + `    \`AGENTS.md\` ${LOCALISED} says …\n`
      + `⚠️ Keep "${LOCALISED}" on the SAME LINE as the path, or this check reports your fix.`,
    ).toEqual([]);
  });
});
