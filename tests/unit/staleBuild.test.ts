import { describe, it, expect } from 'vitest';
import { isStaleBuildError } from '../../lib/staleBuild';

// SQEM-301 — the wording differs per browser, so each one is pinned. A browser that renames its
// message is a silent regression otherwise: the screen would quietly go back to saying "Something
// went wrong" after every deploy, and nobody would notice for weeks.
describe('isStaleBuildError', () => {
  const staleBuild = [
    ['Chrome / Edge', 'Failed to fetch dynamically imported module: https://app.sqemes.com/assets/Settings-CzAZU.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite CSS preload', 'Unable to preload CSS for /assets/Chat-abc123.css'],
  ] as const;

  it.each(staleBuild)('recognises the %s wording', (_browser, message) => {
    expect(isStaleBuildError(new TypeError(message))).toBe(true);
  });

  it('recognises a ChunkLoadError by name, whatever it says', () => {
    const err = new Error('anything at all');
    err.name = 'ChunkLoadError';
    expect(isStaleBuildError(err)).toBe(true);
  });

  it('does not care about case', () => {
    expect(isStaleBuildError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  // ⛔ The direction that matters. Mistaking a crash for an update tells somebody to reload when
  // reloading cannot help, and hides a real defect behind a cheerful screen.
  describe('treats anything it does not recognise as a real error', () => {
    it.each([
      ['a genuine crash', new TypeError("Cannot read properties of undefined (reading 'map')")],
      ['a network failure', new TypeError('Failed to fetch')],
      ['a thrown string', 'something went wrong'],
      ['null', null],
      ['undefined', undefined],
    ])('%s', (_label, thrown) => {
      expect(isStaleBuildError(thrown)).toBe(false);
    });
  });

  // "Failed to fetch" is a substring of nothing here — the module wording is what distinguishes a
  // missing chunk from any other failed request, and this is the pair that proves it.
  it('separates a failed fetch from a failed module fetch', () => {
    expect(isStaleBuildError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true);
  });
});
