import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import {
  classifySkillFile, isUtf8Text, sniffBinaryMime, isTextContentMime,
  TEXT_EXT_TO_MIME, SKILL_STORAGE_MIMES, OCTET_STREAM, STORAGE_TEXT_MIME,
} from '../../supabase/functions/_shared/skillFile';
import { dropUnsendableParts, dropUnsendableInMessages, isSendableMime } from '../../supabase/functions/_shared/messageParts';
import { fileTypeLabel } from '../../lib/uploadTypes';

/**
 * SQEM-514 — one rule for what a file in a skill IS. Text by its bytes, an image/PDF by its signature,
 * the rest application/octet-stream. Checked against real files where the repo has them, and against
 * byte layouts that match the real formats where it does not (a TTF starts 00 01 00 00, a .docx is a
 * zip) — committing a system font or an Office file for a test would carry someone else's licence.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p));
const enc = (s: string) => new TextEncoder().encode(s);
// Line comments first, then block comments (comment-stripper-order lesson).
const code = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

async function docxBytes(): Promise<Uint8Array> {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  z.file('word/document.xml', '<w:document/>');
  return z.generateAsync({ type: 'uint8array' });
}

describe('classifySkillFile — real and format-true files', () => {
  it('a real PNG from the repo is an image, stored as itself', () => {
    const t = classifySkillFile('assets/logo.png', new Uint8Array(read('public/icon-192.png')));
    expect(t).toEqual({ rowMime: 'image/png', storageMime: 'image/png', isText: false });
  });

  it('a TrueType font is binary → octet-stream (its header holds NUL bytes)', () => {
    const ttf = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x80, 0x00, 0x03, 0x00, 0x60]);
    expect(classifySkillFile('canvas-design/assets/fonts/Inter.ttf', ttf)).toEqual({ rowMime: OCTET_STREAM, storageMime: OCTET_STREAM, isText: false });
  });

  it('a .docx (a zip) is octet-stream, not text and not an image', async () => {
    expect(classifySkillFile('docx/template.docx', await docxBytes()).rowMime).toBe(OCTET_STREAM);
  });

  it('a PDF is a PDF — with the usual binary comment line AND written in plain ASCII', () => {
    const withBinary = Uint8Array.from([...enc('%PDF-1.7\n%'), 0xe2, 0xe3, 0xcf, 0xd3, ...enc('\n1 0 obj')]);
    const asciiOnly = enc('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    expect(isUtf8Text(asciiOnly)).toBe(true); // the trap the signature check exists for
    expect(classifySkillFile('brief.pdf', withBinary).rowMime).toBe('application/pdf');
    expect(classifySkillFile('brief.pdf', asciiOnly).rowMime).toBe('application/pdf');
  });

  it('an XML schema is text with its own row type', () => {
    const t = classifySkillFile('docx/ooxml/schemas/wml.xsd', enc('<?xml version="1.0"?><xs:schema/>'));
    expect(t).toEqual({ rowMime: STORAGE_TEXT_MIME, storageMime: STORAGE_TEXT_MIME, isText: true });
    expect(classifySkillFile('data.xml', enc('<a/>')).rowMime).toBe('text/xml');
  });

  it('an SVG with a script element is TEXT — stored text/plain, never as an image type', () => {
    const svg = enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(classifySkillFile('diagram.svg', svg)).toEqual({ rowMime: STORAGE_TEXT_MIME, storageMime: STORAGE_TEXT_MIME, isText: true });
  });

  it('UTF-8 with umlauts is text; UTF-16 is binary', () => {
    expect(classifySkillFile('notes.md', enc('Grüße — Äpfel, Öl, Übung, ß ✓')).rowMime).toBe('text/markdown');
    const utf16 = Uint8Array.from([0xff, 0xfe, ...Array.from(Buffer.from('hello', 'utf16le'))]);
    expect(classifySkillFile('notes.txt', utf16).rowMime).toBe(OCTET_STREAM);
  });

  it('an extension never makes a file an image: text named .png is text, garbage named .png is octet-stream', () => {
    expect(classifySkillFile('fake.png', enc('not a picture')).isText).toBe(true);
    expect(classifySkillFile('fake.png', Uint8Array.from([0x00, 0xff, 0x10])).rowMime).toBe(OCTET_STREAM);
  });

  it('sniffs all five binary types it stores as themselves', () => {
    expect(sniffBinaryMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffBinaryMime(enc('GIF89a'))).toBe('image/gif');
    expect(sniffBinaryMime(enc('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffBinaryMime(enc('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
  });
});

describe('⛔ the invariant every reader rests on', () => {
  it('every text row type passes isTextContentMime', () => {
    for (const mime of [...Object.values(TEXT_EXT_TO_MIME), STORAGE_TEXT_MIME]) expect(isTextContentMime(mime), mime).toBe(true);
  });

  it('no binary type the rule hands out passes it', () => {
    for (const mime of SKILL_STORAGE_MIMES.filter(m => m !== STORAGE_TEXT_MIME)) expect(isTextContentMime(mime), mime).toBe(false);
  });

  it('every storage type the rule hands out is in SKILL_STORAGE_MIMES (the bucket list)', async () => {
    const samples = [enc('x'), new Uint8Array(read('public/icon-192.png')), await docxBytes(), enc('%PDF-1.4')];
    for (const b of samples) expect(SKILL_STORAGE_MIMES).toContain(classifySkillFile('f', b).storageMime);
  });

  it('libraryQueries uses the shared test rather than its own copy', () => {
    const src = code(readFileSync(resolve(ROOT, 'supabase/functions/_shared/libraryQueries.ts'), 'utf8'));
    expect(src).toMatch(/import \{ isTextContentMime \} from '\.\/skillFile\.ts'/);
    expect(src).not.toMatch(/function isTextContentMime/);
  });
});

describe('⛔ no reader treats a binary skill file as an image or as text', () => {
  it('a part no provider can take becomes a short text part; text, PDF and raster images pass', () => {
    const parts = [
      { inlineData: { mimeType: OCTET_STREAM, data: 'AAAA' } },
      { inlineData: { mimeType: 'image/svg+xml', data: 'AAAA' } },
      { inlineData: { mimeType: 'application/pdf', data: 'AAAA' } },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
      { inlineData: { mimeType: 'text/markdown', data: 'AAAA' } },
      { text: 'hi' },
    ];
    const out = dropUnsendableParts(parts) as typeof parts;
    expect(out[0]).toEqual({ text: expect.stringMatching(/binary file \(application\/octet-stream\).*not readable here/) });
    expect(out[1].text).toMatch(/not readable here/);
    expect(out.slice(2)).toEqual(parts.slice(2));
    expect(isSendableMime('application/json')).toBe(false); // json never travels as inlineData (read as text first)
  });

  it('a chat history is cleaned message by message; plain strings are untouched', () => {
    const msgs = [{ role: 'user', content: 'plain' }, { role: 'user', content: [{ inlineData: { mimeType: OCTET_STREAM, data: 'x' } }] }];
    const out = dropUnsendableInMessages(msgs);
    expect(out[0]).toBe(msgs[0]);
    expect((out[1].content as unknown as { text: string }[])[0].text).toMatch(/not readable here/);
  });

  for (const [fn, call] of [
    ['chat-message', /const messages = Array\.isArray\(body\.messages\) \? dropUnsendableInMessages\(body\.messages\)/],
    ['execute-step', /const promptContent = dropUnsendableParts\(body\.promptContent\)/],
  ] as const) {
    it(`${fn} cleans the parts on the way in, before any provider branch`, () => {
      const src = code(readFileSync(resolve(ROOT, `supabase/functions/${fn}/index.ts`), 'utf8'));
      expect(src).toMatch(call);
      // The raw body field is never destructured any more — that would bypass the guard.
      expect(src).not.toMatch(/\{[^}]*\b(messages|promptContent)\b[^}]*\} = await req\.json\(\)/);
    });
  }

  it('the browser only reads files that ARE text as text', () => {
    const src = code(readFileSync(resolve(ROOT, 'lib/templateContext.ts'), 'utf8'));
    expect(src).toMatch(/fileIds\.includes\(f\.id\) && isTextContentMime\(f\.mimeType\)/);
  });
});

describe('labels come from the name for files stored generically', () => {
  it('an .svg stored as text/plain reads SVG; a font reads TTF; a plain .txt still reads TXT', () => {
    expect(fileTypeLabel('text/plain', 'diagram.svg')).toBe('SVG');
    expect(fileTypeLabel(OCTET_STREAM, 'assets/Inter.ttf')).toBe('TTF');
    expect(fileTypeLabel('text/plain', 'notes.txt')).toBe('TXT');
    expect(fileTypeLabel('text/markdown', 'x.md')).toBe('MD');
  });
});
