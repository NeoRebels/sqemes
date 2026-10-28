/**
 * SQEM-597 — the logo of a document style, found by its FILE NAME among the files this person can see.
 *
 * A skill names the logo the way a person would ("brand/logo.png"); the model passes that name. It is
 * resolved here, in the browser, against the workspace file list the person already has — so a logo
 * the person may not see cannot be pulled into a document by naming it.
 *
 * Only PNG and JPEG: Word, PDF and PowerPoint all embed those; SVG is not reliably supported by all
 * three. A logo that is not found, or not one of the two, is left out — the caller says so.
 */
import type { WorkspaceFile } from '../types';
import { getWorkspaceFileSignedUrl } from './api/files';
import type { LogoImage } from './fileExport';
import { findLogoFile } from './logoMatch';
import { m } from './i18n';

const IMAGE_TYPES: Record<string, 'png' | 'jpg'> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };

export type LogoResult = { logo: LogoImage } | { missing: string };

export async function loadLogo(name: string, files: WorkspaceFile[]): Promise<LogoResult> {
  const file = findLogoFile(name, files);
  if (!file) return { missing: m.logo_not_found({ name }) };
  const type = IMAGE_TYPES[file.mimeType.toLowerCase()];
  if (!type) return { missing: m.logo_wrong_type({ name: file.name }) };
  try {
    const url = await getWorkspaceFileSignedUrl(file.storagePath);
    const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const blob = new Blob([data], { type: file.mimeType });
    const bitmap = await createImageBitmap(blob);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    // SQEM-597 — a JPEG on white for the PDF (pdfmake would need a blob: worker for a PNG's alpha).
    let pdfDataUrl: string | undefined;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0);
        pdfDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      }
    } catch { /* the PDF then goes without the logo */ }
    const logo = { data, type, dataUrl, width: bitmap.width, height: bitmap.height, ...(pdfDataUrl ? { pdfDataUrl } : {}) };
    bitmap.close();
    return { logo };
  } catch {
    return { missing: m.logo_load_failed({ name: file.name }) };
  }
}
