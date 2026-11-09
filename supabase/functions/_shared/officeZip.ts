// SQEM-658 — the server's unzip for `extractOfficeText`, kept out of libraryQueries.ts because the
// unit tests import that module and Node cannot resolve `npm:` specifiers. Only the two edge
// functions that build a library reader import this file.

import JSZip from 'npm:jszip@3.10.1';
import type { ReadEntry, ReadPicture } from './officeText.ts';

export async function unzipEntries(bytes: ArrayBuffer): Promise<ReadEntry> {
  const zip = await JSZip.loadAsync(bytes);
  return async (path: string) => {
    const entry = zip.file(path);
    return entry ? await entry.async('string') : null;
  };
}

/** SQEM-668 — the same unzip with a second reader for an entry's bytes as base64 (pictures, MCP only). */
export async function unzipWithPictures(bytes: ArrayBuffer): Promise<{ read: ReadEntry; readBase64: ReadPicture }> {
  const zip = await JSZip.loadAsync(bytes);
  return {
    read: async (path: string) => { const entry = zip.file(path); return entry ? await entry.async('string') : null; },
    readBase64: async (path: string) => { const entry = zip.file(path); return entry ? await entry.async('base64') : null; },
  };
}
