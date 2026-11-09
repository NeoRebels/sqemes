import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, ImageRun } from 'docx';
import PptxGenJS from 'pptxgenjs';
import {
  extractOfficeText, pickOfficePictures, officePicturesNote, pictureMimeOf, OFFICE_READER_MARKER,
  MAX_OFFICE_PICTURES, MAX_OFFICE_PICTURE_BYTES, type OfficeKind, type OfficePicture,
} from '../../supabase/functions/_shared/officeText';
import { officeAttachment, OFFICE_PICTURE_PROVIDERS, OFFICE_PICTURES_FOLLOW, OFFICE_PICTURES_LEFT_OUT } from '../../lib/officeAttachment';

// SQEM-668 — pictures inside Word, Excel and PowerPoint: numbered in the text, listed with their path,
// and handed over within the limits. Real files from the libraries the app uses for its own output.

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function open(kind: OfficeKind, name: string, bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const office = await extractOfficeText(kind, name, async p => (zip.file(p) ? zip.file(p)!.async('string') : null));
  return { office, readBase64: async (p: string) => (zip.file(p) ? zip.file(p)!.async('base64') : null) };
}

async function slides(pngs: number, gif = false): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  const s = pptx.addSlide();
  s.addText('Bilder', { x: 1, y: 0.3, w: 8, h: 1 });
  for (let i = 1; i <= pngs; i++) s.addImage({ data: `image/png;base64,${PNG}`, x: 0.5 * i, y: 2, w: 0.4, h: 0.4, altText: `Bild ${i}` });
  if (gif) s.addImage({ data: `image/gif;base64,${GIF}`, x: 1, y: 3, w: 0.4, h: 0.4, altText: 'Animation' });
  return await pptx.write({ outputType: 'nodebuffer' }) as Uint8Array;
}

describe('SQEM-668 — the reader numbers pictures and lists their files', () => {
  it('PowerPoint: in reading order, with path and type; a GIF is named but not passed on', async () => {
    const { office } = await open('pptx', 'Bilder.pptx', await slides(2, true));
    expect(office.pictures.map(p => [p.n, p.label, p.mime])).toEqual([[1, 'Bild 1', 'image/png'], [2, 'Bild 2', 'image/png'], [3, 'Animation', null]]);
    expect(office.pictures[0].path).toMatch(/^ppt\/media\/.+\.png$/);
    expect(office.text).toContain('[Image 1: Bild 1]');
    expect(office.text).toContain('[Image 2: Bild 2]');
    expect(office.text).toContain('[Image 3: Animation (gif, not readable as a picture)]');
    expect(office.text.indexOf('[Image 1')).toBeLessThan(office.text.indexOf('[Image 2'));
  });

  it('Word: a picture inside a paragraph, with its description', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph('Vor dem Bild'),
      new Paragraph({ children: [new ImageRun({ type: 'png', data: Buffer.from(PNG, 'base64'), transformation: { width: 20, height: 20 }, altText: { name: 'logo', description: 'Firmenlogo', title: 'Logo' } })] }),
      new Paragraph('Nach dem Bild'),
    ] }] });
    const { office } = await open('docx', 'Brief.docx', new Uint8Array(await Packer.toBuffer(doc)));
    expect(office.pictures).toHaveLength(1);
    expect(office.pictures[0]).toMatchObject({ n: 1, label: 'Firmenlogo', mime: 'image/png' });
    expect(office.pictures[0].path).toMatch(/^word\/media\//);
    const t = office.text;
    expect(t.indexOf('Vor dem Bild')).toBeLessThan(t.indexOf('[Image 1: Firmenlogo]'));
    expect(t.indexOf('[Image 1: Firmenlogo]')).toBeLessThan(t.indexOf('Nach dem Bild'));
  });

  it('the formats handed over are PNG, JPEG and WebP; the marker changed, so stored texts are read again', () => {
    expect(['a.png', 'a.JPG', 'a.jpeg', 'a.webp'].map(pictureMimeOf)).toEqual(['image/png', 'image/jpeg', 'image/jpeg', 'image/webp']);
    expect(['a.gif', 'a.emf', 'a.wmf', 'a.tiff', 'a'].map(pictureMimeOf)).toEqual([null, null, null, null, null]);
    expect(OFFICE_READER_MARKER).toBe('(sqemes reader 4)');
  });
});

describe('SQEM-668 — which pictures go along', () => {
  it('at most ten, in order; the rest is named with the reason', async () => {
    const { office, readBase64 } = await open('pptx', 'Viele.pptx', await slides(12, true));
    const batch = await pickOfficePictures(office.pictures, readBase64);
    expect(batch.sent.map(p => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(batch.sent[0]).toMatchObject({ mime: 'image/png', base64: PNG });
    expect(batch.notShown).toEqual([{ n: 11, reason: 'count' }, { n: 12, reason: 'count' }, { n: 13, reason: 'format' }]);
    const note = officePicturesNote(batch);
    expect(note).toContain('[Image 1], [Image 2]');
    expect(note).toContain(`past the first ${MAX_OFFICE_PICTURES}`);
    expect(note).toContain('Image 13');
  });

  it('a picture over 4 MB, past 8 MB together, or missing from the file is left out', async () => {
    const mb = (n: number) => 'A'.repeat(Math.ceil(n * 1024 * 1024 * 4 / 3));
    const pics: OfficePicture[] = [1, 2, 3, 4, 5].map(n => ({ n, path: `ppt/media/${n}.png`, label: '', mime: 'image/png' }));
    const sizes: Record<string, string | null> = { 'ppt/media/1.png': mb(5), 'ppt/media/2.png': mb(3.5), 'ppt/media/3.png': mb(3.5), 'ppt/media/4.png': mb(3.5), 'ppt/media/5.png': null };
    const batch = await pickOfficePictures(pics, async p => sizes[p]);
    expect(batch.sent.map(p => p.n)).toEqual([2, 3]);
    expect(batch.notShown).toEqual([{ n: 1, reason: 'size' }, { n: 4, reason: 'size' }, { n: 5, reason: 'missing' }]);
    expect(MAX_OFFICE_PICTURE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('a file without pictures adds no note', async () => {
    expect(officePicturesNote(await pickOfficePictures([], async () => null))).toBe('');
  });

  it('SQEM-671 — follow: false names only what is missing, never that pictures follow', async () => {
    const { office, readBase64 } = await open('pptx', 'Viele.pptx', await slides(12, true));
    const batch = await pickOfficePictures(office.pictures, readBase64);
    const note = officePicturesNote(batch, { follow: false });
    expect(note).not.toContain('follow as images');
    expect(note).toContain('Image 11');
    expect(note).toContain('Image 13');
    const two = await open('pptx', 'Bilder.pptx', await slides(2));
    expect(officePicturesNote(await pickOfficePictures(two.office.pictures, two.readBase64), { follow: false })).toBe('');
  });
});

describe('SQEM-668 — chat attachment', () => {
  it('the pictures come back as image data URLs, and the text says they follow', async () => {
    const a = await officeAttachment(new Blob([await slides(2)]), 'Bilder.pptx');
    expect(a.pictures.map(p => [p.n, p.mimeType])).toEqual([[1, 'image/png'], [2, 'image/png']]);
    expect(a.pictures[0].dataUrl).toBe(`data:image/png;base64,${PNG}`);
    const text = new TextDecoder().decode(Uint8Array.from(atob(a.dataUrl.split(',')[1]), c => c.charCodeAt(0)));
    // SQEM-671 — the text no longer says they follow: whether they do is decided per model at send time.
    expect(text).not.toContain('follow as images');
    expect(text).toContain('[Image 1: Bild 1]');
  });

  it('only the measured providers get them; the others get the text and a sentence (Chat.tsx)', () => {
    // SQEM-671 — each one tested; OpenRouter stays out (a tested model refused every picture).
    expect([...OFFICE_PICTURE_PROVIDERS].sort()).toEqual(['claude', 'deepseek', 'gemini', 'grok', 'mistral', 'openai']);
    expect(OFFICE_PICTURE_PROVIDERS.has('openrouter')).toBe(false);
    expect(OFFICE_PICTURES_LEFT_OUT).toMatch(/that are not attached here as images were NOT passed to you\. You cannot see them: do not describe, guess or infer/);
    expect(OFFICE_PICTURES_FOLLOW).toMatch(/are its \[Image n\] pictures/);
    const chat = readFileSync(resolve(__dirname, '../../pages/Chat.tsx'), 'utf8');
    expect(chat).toMatch(/takesOfficePictures \? m\.attachments : m\.attachments\.filter\(a => !a\.officePicture\)/);
    expect(chat).toMatch(/const pictureProvider = isFundedModel\(selectedModel\) \? 'mistral'/);
    expect(chat).toMatch(/const takesOfficePictures = !!pictureProvider && OFFICE_PICTURE_PROVIDERS\.has\(pictureProvider\)/);
    // SQEM-671 — exactly one sentence: left out, or follow — never both. Missing is counted against what the
    // file brought, so pictures the person removed count too (Mistral guessed colours without a sentence).
    expect(chat).toMatch(/const expected = m\.attachments\.reduce\(\(n, a\) => n \+ \(a\.officePictures \?\? 0\), 0\);/);
    expect(chat).toMatch(/if \(expected > 0 && sent < expected\) content\.push\(\{ text: OFFICE_PICTURES_LEFT_OUT \}\);\s*else if \(sent > 0\) content\.push\(\{ text: OFFICE_PICTURES_FOLLOW \}\);/);
    expect(chat).toMatch(/mimeType: 'text\/plain', label, tables, \.\.\.\(pictures\.length \? \{ officePictures: pictures\.length \} : \{\}\)/);
    // ⛔ Both copies keep the count as well as the flag (the SQEM-668 trap).
    expect(chat).toMatch(/const currentAttachments = attachments\.map\(a => \(\{[^\n]*\.\.\.\(a\.officePictures \? \{ officePictures: a\.officePictures \} : \{\}\)/);
    expect(chat).toMatch(/setAttachments\(msg\.attachments\.map\(a => \(\{[^\n]*\.\.\.\(a\.officePictures \? \{ officePictures: a\.officePictures \} : \{\}\)/);
    expect(chat).toMatch(/officePictures: officePicturesSent/);
    // ⛔ Found in testing: the copy into the message dropped the flag, so the gate let every picture through.
    expect(chat).toMatch(/const currentAttachments = attachments\.map\(a => \(\{[^\n]*\.\.\.\(a\.officePicture \? \{ officePicture: true \} : \{\}\)/);
    expect(chat).toMatch(/setAttachments\(msg\.attachments\.map\(a => \(\{[^\n]*\.\.\.\(a\.officePicture \? \{ officePicture: true \} : \{\}\)/);
  });
});

describe('SQEM-668 — chat-message logs what pictures cost', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');
  it('[chat-images] for every answer to a message with pictures, with its tokens', () => {
    expect(src).toMatch(/if \(request\.images\) \{\s*console\.log\('\[chat-images\]'/);
    expect(src).toMatch(/inputTokens: tools\?\.stats\.inputTokens \?\? null/);
  });
  it('the count comes from the newest message and is carried across hand-overs; errors say whether pictures were involved', () => {
    expect(src).toMatch(/const images = continuation \? \(src\.images \?\? 0\)/);
    expect(src).toMatch(/\.\.\.\(images \? \{ images, officePictures \} : \{\}\) \} satisfies ContinuationRequest/);
    expect(src).toMatch(/\[chat-error\]'.*images: request\.images/);
  });
});
