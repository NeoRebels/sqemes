// SQEM-658 — a Word, Excel or PowerPoint chat attachment, read in the browser and sent as text.
//
// ⭐ Why in the browser: an edge function has little pure CPU time and a 15 MB workbook is real
// work; here it costs the person's machine a moment and the server nothing. And because it becomes
// a text attachment, `chat-message` needs no change and every provider gets it — the same path a
// .txt or .csv already takes. The reader itself is shared with `read_context_file` on the server
// (`supabase/functions/_shared/officeText.ts`), so a file reads the same in both places.
//
// No Supabase import: tests load this without env vars.

import { extractOfficeText, officeKindOf, type OfficeKind, type OfficeText } from '../supabase/functions/_shared/officeText';

export interface OfficeAttachment {
  /** `data:text/plain;base64,…` of the extracted Markdown (UTF-8). */
  dataUrl: string;
  /** What the chip shows — DOCX, XLSX or PPTX — since the attachment itself is text. */
  label: string;
  truncated: boolean;
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
  const kind = officeKindOf(name) as OfficeKind;
  // Loaded on the first Office file only, like the libraries behind Chat's file output.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  return extractOfficeText(kind, name, async p => {
    const entry = zip.file(p);
    return entry ? entry.async('string') : null;
  });
}

export async function officeAttachment(file: Blob, name: string): Promise<OfficeAttachment> {
  const { text, truncated } = await readOfficeText(file, name);
  return { dataUrl: `data:text/plain;base64,${utf8ToBase64(text)}`, label: (officeKindOf(name) as OfficeKind).toUpperCase(), truncated };
}
