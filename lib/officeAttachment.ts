// SQEM-658 — a Word, Excel or PowerPoint chat attachment, read in the browser and sent as text.
//
// ⭐ Why in the browser: an edge function has little pure CPU time and a 15 MB workbook is real
// work; here it costs the person's machine a moment and the server nothing. And because it becomes
// a text attachment, `chat-message` needs no change and every provider gets it — the same path a
// .txt or .csv already takes. The reader itself is shared with `read_context_file` on the server
// (`supabase/functions/_shared/officeText.ts`), so a file reads the same in both places.
//
// No Supabase import: tests load this without env vars.

import { extractOfficeText, officeKindOf, officePicturesNote, pickOfficePictures, type OfficeKind, type OfficeText, type ReadPicture } from '../supabase/functions/_shared/officeText';

export interface OfficeAttachment {
  /** `data:text/plain;base64,…` of the extracted Markdown (UTF-8). */
  dataUrl: string;
  /** What the chip shows — DOCX, XLSX or PPTX — since the attachment itself is text. */
  label: string;
  truncated: boolean;
  /**
   * SQEM-668 — the file's pictures, in the order of their `[Image n]` markers, within the reader's
   * limits. Attached as ordinary image attachments; at send time they go only to providers measured
   * to take them (`OFFICE_PICTURE_PROVIDERS`).
   */
  pictures: { n: number; mimeType: string; dataUrl: string }[];
}

/** UTF-8 → base64 in chunks: `btoa` takes Latin-1 only, and a spread of a large array overflows the stack. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The reader's text of an Office file, in the browser. Also used when a file is uploaded (SQEM-658). */
export async function readOfficeText(file: Blob, name: string): Promise<OfficeText> {
  return (await readOffice(file, name)).office;
}

/** The text, and a reader for the file's entries as base64 (pictures, SQEM-668). */
async function readOffice(file: Blob, name: string): Promise<{ office: OfficeText; readBase64: ReadPicture }> {
  const kind = officeKindOf(name) as OfficeKind;
  // Loaded on the first Office file only, like the libraries behind Chat's file output.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const office = await extractOfficeText(kind, name, async p => {
    const entry = zip.file(p);
    return entry ? entry.async('string') : null;
  });
  return { office, readBase64: async p => { const entry = zip.file(p); return entry ? entry.async('base64') : null; } };
}

/**
 * SQEM-668 — the providers a picture from an Office file goes to, each one tested with real pictures,
 * not taken from its docs (SQEM-668, SQEM-671). ⛔ Not OpenRouter: whether a picture goes through
 * depends on the model there, and a tested model refused every picture (404 "No endpoints found
 * that support image input"). Another provider gets the text and a sentence that the pictures are missing.
 */
export const OFFICE_PICTURE_PROVIDERS = new Set(['claude', 'openai', 'gemini', 'mistral', 'deepseek', 'grok']);

/** SQEM-671 — the one sentence the model gets about an Office file's pictures, set at send time. */
export const OFFICE_PICTURES_FOLLOW = '[sqemes: the pictures attached after the Office file are its [Image n] pictures, in the order of their numbers.]';
export const OFFICE_PICTURES_LEFT_OUT = '[sqemes: pictures of the attached Office file ([Image n] in its text) that are not attached here as images were NOT passed to you. You cannot see them: do not describe, guess or infer what they show. If asked about them, say that they were not passed.]';

export async function officeAttachment(file: Blob, name: string): Promise<OfficeAttachment> {
  const { office: { text, truncated, pictures }, readBase64 } = await readOffice(file, name);
  const batch = await pickOfficePictures(pictures, readBase64);
  const note = officePicturesNote(batch, { follow: false }); // SQEM-671 — Chat says whether they follow, at send time
  return {
    dataUrl: `data:text/plain;base64,${utf8ToBase64(note ? `${text}\n\n${note}` : text)}`,
    label: (officeKindOf(name) as OfficeKind).toUpperCase(),
    truncated,
    pictures: batch.sent.map(p => ({ n: p.n, mimeType: p.mime, dataUrl: `data:${p.mime};base64,${p.base64}` })),
  };
}
