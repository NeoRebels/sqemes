import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-431 — the connector tiles draw the real brand marks.
 *
 * ⛔ **Why this is a test and not just a fixed file.** `PlaudIcon` shipped an invented microphone
 * glyph together with a licence argument for drawing one — and the argument cited SQEM-207/386, which
 * are about the **Chrome Web Store badge**, a mark Google publishes narrow usage rules for. Applied
 * to a connector tile it was simply wrong, and it was wrong in the most durable way available: as a
 * comment that reads like a decided rule, in the file the next person would copy from.
 */
const ROOT = resolve(__dirname, '../../');
const DIR = resolve(ROOT, 'components/icons');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));
const read = (f: string) => readFileSync(resolve(DIR, f), 'utf8');

describe('SQEM-431 — connector icons', () => {
  it('the tiles carry brand marks — no icon claims we may not draw one', () => {
    // The badge is the one place the restriction is real, so it is the one file allowed to say so.
    for (const f of files.filter((n) => n !== 'ChromeWebStoreIcon.tsx')) {
      const src = read(f);
      expect(src, `${f} must not re-introduce the licence claim`).not.toMatch(/no licence to reproduce|a redrawn brand logo is still a brand logo/i);
      expect(src, `${f} must not describe itself as a neutral stand-in`).not.toMatch(/\bneutral \w+ glyph\b|Deliberately NOT the company's logo/i);
    }
  });

  it('⛔ the Chrome Web Store badge keeps its own rule', () => {
    // It is not the same case: Google publishes explicit rules for the badge. Deleting this note
    // because "the other icons draw real logos" is the mistake in the opposite direction.
    expect(read('ChromeWebStoreIcon.tsx')).toMatch(/⛔ Not Google's Chrome logo/);
  });

  it('Plaud is the arch-and-dot mark, not a microphone', () => {
    const src = read('PlaudIcon.tsx');
    expect(src).toMatch(/aria-label="Plaud"/);
    expect(src).toMatch(/<circle cx="12"/);          // the dot in the opening
    expect(src).not.toMatch(/rect .*rx="3"/);        // the old microphone body
    expect(src).toMatch(/currentColor/);             // black mark ⇒ must follow the theme
  });

  it('every icon stays inline and CSP-safe — no external asset, no data URI', () => {
    // An external asset would need a CSP exception; a data-URI PNG would put ~12 KB of base64 in the
    // bundle for something a path draws better, and would not follow the dark theme.
    for (const f of files) {
      expect(read(f), f).not.toMatch(/src=|url\(|data:image/);
    }
  });
});
