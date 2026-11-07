// SQEM-658 — the server's unzip for `extractOfficeText`, kept out of libraryQueries.ts because the
// unit tests import that module and Node cannot resolve `npm:` specifiers. Only the two edge
// functions that build a library reader import this file.

import JSZip from 'npm:jszip@3.10.1';
import type { ReadEntry } from './officeText.ts';

export async function unzipEntries(bytes: ArrayBuffer): Promise<ReadEntry> {
  const zip = await JSZip.loadAsync(bytes);
  return async (path: string) => {
    const entry = zip.file(path);
    return entry ? await entry.async('string') : null;
  };
}
