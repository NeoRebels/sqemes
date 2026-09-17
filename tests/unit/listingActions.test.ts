import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-415 — the two controls on a listing that a UX tester (2026-09-16) could not find or misread.
 *
 * `ListingView` renders a listing for both the signed-in marketplace and the public page, and it
 * imports the store, so it is read as source rather than rendered (see `tests-must-not-import-supabase`).
 */
const ROOT = resolve(__dirname, '../../');
/** JSX comments first, then line comments, then block comments — the order matters: a `//` line
 *  containing `/*` swallows the rest of the file when block comments are stripped first. */
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const LISTING = code(readFileSync(resolve(ROOT, 'components/marketplace/ListingView.tsx'), 'utf8'));

describe('SQEM-415 — the download is a control, and the panel names the thing', () => {
  it('⛔ "Download Playbook" is an outline button, not an underlined text link', () => {
    const i = LISTING.indexOf('Download Playbook');
    expect(i).toBeGreaterThan(-1);
    const button = LISTING.slice(Math.max(0, i - 900), i);
    expect(button, 'the underlined link read as fine print next to two filled buttons').not.toMatch(/underline/);
    expect(button).toMatch(/border border-slate-200/);
    expect(button).toMatch(/rounded-xl/);
  });

  it('⛔ it stays secondary — no brand fill, that belongs to "Add to playbooks"', () => {
    const i = LISTING.indexOf('Download Playbook');
    const button = LISTING.slice(Math.max(0, i - 900), i);
    expect(button).not.toMatch(/bg-brand-600/);
  });

  it('the file panel says playbook, not "copy"', () => {
    expect(LISTING).toContain('What comes with this playbook');
    expect(LISTING).not.toContain('What comes with this copy');
  });
});
