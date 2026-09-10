import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-368 — the version pin example in `SELF_HOSTING.md` must name the version being released.
 *
 * ⛔ It has gone stale at four cuts in a row and the gap keeps growing: two releases behind at
 * v1.11.3, **four** at v1.11.8, one at v1.11.11 — and that last one had been checked four hours
 * earlier at the v1.11.10 cut, when it was still right. A second cut the same day was not
 * foreseeable from the first.
 *
 * ⭐ That is the whole argument for a test rather than another checklist line. "Check the pin" lives
 * at the end of a release, where it competes with everything else; the version bump is a single
 * commit, and this fails in that commit's own CI run. A rule you have to remember failed four times.
 * A test that fails on the bump cannot.
 *
 * ⚠️ It reads the file a self-hoster reads. `SELF_HOSTING.md` is exported to the public repo, so a
 * pin naming a tag that predates the release tells a stranger to check out old code.
 */
const root = (p: string) => resolve(__dirname, '../../', p);

describe('SQEM-368 — the self-host pin example tracks the release', () => {
  const version = JSON.parse(readFileSync(root('package.json'), 'utf8')).version as string;
  const doc = readFileSync(root('SELF_HOSTING.md'), 'utf8');

  it('the document pins a version at all', () => {
    expect(doc, 'no `git checkout vX.Y.Z` example found — did the update section move?')
      .toMatch(/git checkout v\d+\.\d+\.\d+/);
  });

  it('every pinned tag matches the current package version', () => {
    // All of them, not the first: a second example added later would otherwise drift unwatched.
    const pins = [...doc.matchAll(/git checkout (v\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect(pin, `pin ${pin} does not match package.json ${version} — bump it in the same commit`)
        .toBe(`v${version}`);
    }
  });
});
