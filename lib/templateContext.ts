import { isImageType } from './uploadTypes';
import { getWorkspaceFileSignedUrl } from './api/files';
import type { Prompt } from '../types';

/**
 * SQEM-371 — resolving a template into the context it contributes, in ONE place.
 *
 * This lived inside `TemplateLaunchModal` and was fine while it ran exactly once: at the moment
 * somebody picked a template. Applied context now belongs to the **session**, so it has to be
 * rebuilt when a session is *loaded* too — a second caller, and therefore a shared module rather
 * than a copy.
 *
 * ⚠️ **Context files are fetched at use time, deliberately.** Nothing is snapshotted into the
 * session: an edited file reaches the next message, and a deleted one simply stops contributing.
 * Storing the resolved text would have made a session carry a copy of a document the workspace has
 * since changed — silently, and forever.
 */

/** A file that goes to the model as data rather than text: images and PDFs. */
export interface ContextImage { mimeType: string; dataUrl: string; name: string; }

/** Anything a workspace file listing has to provide for the resolution below. */
export interface ResolvableFile {
  id: string;
  name: string;
  mimeType: string;
  storagePath: string;
}

export const isAttachmentType = (mimeType: string) => isImageType(mimeType) || mimeType === 'application/pdf';

/**
 * Images and PDFs → base64 data URLs, delivered to the model as `inlineData`.
 *
 * ⚠️ A file that fails to load is skipped, not thrown. One unreachable attachment must not cost the
 * whole application of a template — the rest of the context is still worth having.
 */
export async function resolveAttachmentFiles(
  files: ResolvableFile[],
  fileIds: string[],
): Promise<ContextImage[]> {
  const attachFiles = files.filter(f => fileIds.includes(f.id) && isAttachmentType(f.mimeType));
  const results: ContextImage[] = [];
  await Promise.all(attachFiles.map(async f => {
    try {
      const url = await getWorkspaceFileSignedUrl(f.storagePath);
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      results.push({ mimeType: f.mimeType, dataUrl, name: f.name });
    } catch { /* skip files that fail to load */ }
  }));
  return results;
}

/** Text and code files → raw text blocks, fetched at use time; no extraction pipeline. */
export async function resolveFileBlocks(
  files: ResolvableFile[],
  fileIds: string[],
): Promise<string[]> {
  const textFiles = files.filter(f => fileIds.includes(f.id) && !isAttachmentType(f.mimeType));
  const blocks: string[] = [];
  await Promise.all(textFiles.map(async f => {
    try {
      const url = await getWorkspaceFileSignedUrl(f.storagePath);
      const res = await fetch(url);
      const text = await res.text();
      if (text.trim()) blocks.push(`[Context: ${f.name}]\n${text.trim()}`);
    } catch { /* skip */ }
  }));
  return blocks;
}

/**
 * The system-context a template contributes when it is **applied** — an assistant or a skill.
 *
 * ⛔ Not for prompts. A prompt is a task the person should still be able to edit before sending;
 * turning it into system context would take exactly that away. It keeps going into the composer.
 */
export async function resolveAppliedContext(
  template: Prompt,
  files: ResolvableFile[],
): Promise<{ text: string; images: ContextImage[] }> {
  const fileIds = template.contextFileIds ?? [];
  const [blocks, images] = await Promise.all([
    resolveFileBlocks(files, fileIds),
    resolveAttachmentFiles(files, fileIds),
  ]);

  // An assistant leads with its system instruction; a skill has none and leads with its body.
  // Both then carry their context files.
  const head = template.kind === 'assistant' ? template.systemInstruction : template.content;
  const text = [head, ...blocks].filter(Boolean).join('\n\n');
  return { text, images };
}

// SQEM-371 — `composeSystemInstruction` lives in `lib/systemInstruction.ts`, not here: this module
// reaches `lib/supabase` through the files API, and that throws at import time without env vars.
// Re-exported so callers have one place to import from.
export { composeSystemInstruction } from './systemInstruction';
