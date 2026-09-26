import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-463 — `package.json` and `package-lock.json` carry the same version.
 *
 * They drifted through **three** self-host cuts: the lockfile sat at 1.11.17 while the package
 * climbed to 1.11.20, because a version bump touched only `package.json` and nothing said otherwise.
 *
 * ⚠️ **Nothing broke, and that is the point.** Measured at the v1.11.20 cut (SQEM-462) with a real
 * `npm ci`: it validates the dependency tree, not the root `version`, so the public CI went green
 * three times over the mismatch. A number that is wrong and harmless is the kind that survives —
 * until someone reads it as the real one (the same shape as the dead `package.json` version in the
 * extension, SQEM-356).
 *
 * ⛔ **The cost of this guard is real and was accepted deliberately** (owner, 2026-09-22): a version
 * bump now touches TWO files. The cut procedure in `pm/PRODUCTION_PROMOTION.md` in the source repository
 * says so at the bump step; this test is what makes forgetting it loud instead of silent.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

describe('SQEM-463 — the version is written once, not twice', () => {
  const pkg = read('package.json');
  const lock = read('package-lock.json');

  it('⛔ package-lock.json matches package.json', () => {
    expect(
      lock.version,
      `package-lock.json says ${lock.version}, package.json says ${pkg.version}. ` +
      'A version bump touches BOTH files — edit the two "version" fields in the lockfile by hand ' +
      '(root and packages[""]), do NOT regenerate it: that would re-resolve dependencies, which is ' +
      'not what a bump is for.',
    ).toBe(pkg.version);
  });

  it('⛔ the lockfile\'s own root package entry matches too', () => {
    // npm writes the version in two places; fixing only the top one leaves half the drift behind.
    expect(
      lock.packages?.['']?.version,
      'packages[""].version in the lockfile is the second copy — bump it with the first.',
    ).toBe(pkg.version);
  });
});
