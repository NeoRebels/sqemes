import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-455 — what a shared sqemes link looks like in WhatsApp, Slack or iMessage.
 *
 * ⛔ **These tags are the ONLY preview such a link can have, and that is a routing fact.** The app is
 * a HashRouter: a marketplace link reads `app.sqemes.com/#/library/<id>`, and everything after `#`
 * is client-side by definition — it never reaches the server. A crawler fetches `/` and cannot know
 * which listing was meant. So one description for the product, not one per page; a per-listing
 * preview would need a real path plus server-rendered tags, which is its own decision.
 */
const root = (p: string) => resolve(__dirname, '../../', p);

/**
 * ⚠️ Comments stripped, and not as a precaution: the block in `index.html` explains at length WHY
 * `og:image` is absent and why paths stay relative — so an assertion on those words would match its
 * own justification. Fourth time in this repo that documenting a decision would have broken the test
 * guarding it (SQEM-359, -360, -361).
 */
const INDEX = readFileSync(root('index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/**
 * Width and height straight out of a JPEG's SOF marker — no image library needed.
 * ⚠️ Not the PNG helper from `pwaManifest.test.ts`: that reads a fixed IHDR offset, which a JPEG
 * does not have. Here the segments have to be walked, because an encoder may put EXIF (or anything
 * else) before the frame header — `sips` does exactly that.
 */
function jpeg(file: string): { width: number; height: number } {
  const b = readFileSync(root(file));
  if (b.readUInt16BE(0) !== 0xffd8) throw new Error(`${file} is not a JPEG`);
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    // SOF0/1/2/3, 9-11, 13-15 carry the frame header; C4/C8/CC are tables, not frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`${file}: no SOF marker`);
}

const OG_IMAGE_FILE = 'public/og-image.jpg';
/**
 * ⚠️ WhatsApp silently drops a preview image it considers too large, and the result looks exactly
 * like having no image at all. The master (`pm/sqemes-share-og.jpg` in the source repository) is
 * 398 KB; what ships is the same picture at quality 85. Keep a margin under 300 KB.
 */
const MAX_BYTES = 300_000;

describe('SQEM-455 — link previews', () => {
  it('the tags a crawler actually reads are present', () => {
    // Without these, WhatsApp showed the favicon, the word "sqemes" and the bare domain — that was
    // everything it could find.
    expect(INDEX).toMatch(/<meta property="og:title" content="[^"]{10,}"/);
    expect(INDEX).toMatch(/<meta property="og:description" content="[^"]{30,}"/);
    expect(INDEX).toMatch(/<meta property="og:type" content="website"/);
    expect(INDEX).toMatch(/<meta name="twitter:card" content="summary/);
  });

  it('⛔ the description says what the product is, in the product\'s own words', () => {
    // `CLAUDE.md` in the source repository forbids describing this as prompt management anywhere a
    // person reads it — and a link preview is read by more strangers than any page in the app.
    const og = INDEX.match(/og:description" content="([^"]+)"/)![1];
    expect(og).not.toMatch(/prompt manager|prompt library|prompt management|prompt OS/i);
    // The vocabulary decision from SQEM-394: a person reads "playbook".
    expect(og).toMatch(/playbook/i);
  });

  it('⚠️ no absolute URLs and no og:url — this file is exported to self-host', () => {
    // An absolute `https://app.sqemes.com/...` would make every link shared from somebody ELSE's
    // instance advertise our domain and our image. A relative path resolves against the page's own
    // origin, which is what both WhatsApp and Facebook do.
    const tags = INDEX.match(/<meta (?:property|name)="(?:og|twitter):[^"]+" content="[^"]*"/g) ?? [];
    expect(tags.length).toBeGreaterThan(3);
    for (const t of tags) expect(t, `${t} must not name a host`).not.toMatch(/https?:\/\//);
    expect(INDEX).not.toMatch(/property="og:url"/);
  });

  it('⛔ og:image and the image file arrive together, or not at all', () => {
    // A tag pointing at a missing file is WORSE than no tag: several crawlers then show no image at
    // all, instead of falling back to the favicon. The owner supplies the artwork (a design
    // decision, not a technical one), so until `public/og-image.png` lands there is no tag — and
    // once it lands, this test stops the tag from being forgotten.
    const hasTag = /property="og:image"/.test(INDEX);
    const hasFile = existsSync(root(OG_IMAGE_FILE));
    expect(hasTag, `og:image tag present=${hasTag} but ${OG_IMAGE_FILE} present=${hasFile}`).toBe(hasFile);

    if (hasFile) {
      // 1200x630 is the size that yields the large card. Our other images are square (513, 512,
      // 180) and would be cropped or shown as a thumbnail — which is the state this ticket fixes.
      const { width, height } = jpeg(OG_IMAGE_FILE);
      expect({ width, height }).toEqual({ width: 1200, height: 630 });
      // ⚠️ Size is not cosmetic here — see MAX_BYTES.
      expect(readFileSync(root(OG_IMAGE_FILE)).byteLength).toBeLessThan(MAX_BYTES);
      // The large card needs the matching twitter:card value, or X still renders the small one.
      expect(INDEX).toMatch(/name="twitter:card" content="summary_large_image"/);
      expect(INDEX).toMatch(/property="og:image" content="\/og-image\.jpg"/);
      // The declared size lets a crawler lay the card out before the image has downloaded, and a
      // wrong one is worse than none — so it is checked against the file, not merely present.
      expect(INDEX).toMatch(/property="og:image:width" content="1200"/);
      expect(INDEX).toMatch(/property="og:image:height" content="630"/);
      // Someone using a screen reader gets the picture described; the card is often the only thing
      // they meet before deciding to open the link.
      expect(INDEX).toMatch(/property="og:image:alt" content="[^"]{20,}"/);
    }
  });
});
