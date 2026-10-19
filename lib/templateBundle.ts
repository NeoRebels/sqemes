// SQEM-161 (Phase 1 of SQEM-160) — the serialize + apply core for template portability. Turns templates
// (+ all referenced context-file bytes) into a portable `.sqemes.zip` bundle, and
// applies a bundle back into a workspace with fresh ids. Client-side (JSZip). Reused later by share links
// (Phase 2) and the UGC marketplace (Phase 3).
import JSZip from 'jszip';
import type { Persona, Prompt, PromptKind, WorkspaceFile } from '../types';
// SQEM-258 — the format itself lives in `bundleFormat.ts`, which imports nothing but JSZip. This
// module keeps the two halves that genuinely need the network. Re-exported so no call site moved.
import { BUNDLE_SCHEMA, sanitizeName, readBundle, downloadBlob } from './bundleFormat';
import type { BundleFile, BundleTemplate, BundleManifest, BundlePersona } from './bundleFormat';
export { BUNDLE_SCHEMA, readBundle, downloadBlob };
export type { BundleFile, BundleTemplate, BundleManifest, BundlePersona };
import { createPrompt, deletePrompt } from './api/prompts';
import { createPersona, deletePersona, setPersonaRoutes } from './api/personas';
import { errorMessage } from './errorMessage';
import { getWorkspaceFileSignedUrl, uploadSkillFile, deleteWorkspaceFile } from './api/files';


// ---- Export ----------------------------------------------------------------------------------------

/** SQEM-521 — at most this many downloads at a time while a bundle is built. */
export const FETCH_CONCURRENCY = 4;

/**
 * The bytes of every file, by id; `null` for one that could not be fetched (skipped, as before).
 * All links are requested in the same tick, so `queueSign` (`lib/api/files.ts`) sends them in ONE
 * `sign-file-url` call (up to 200 paths); the downloads then run FETCH_CONCURRENCY at a time.
 */
export async function fetchFiles(files: WorkspaceFile[]): Promise<Map<string, Blob | null>> {
  const urls = await Promise.all(files.map(f => getWorkspaceFileSignedUrl(f.storagePath).catch(() => null)));
  const out = new Map<string, Blob | null>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const i = next++;
      const url = urls[i];
      if (!url) { out.set(files[i].id, null); continue; }
      try {
        const resp = await fetch(url);
        out.set(files[i].id, resp.ok ? await resp.blob() : null);
      } catch {
        out.set(files[i].id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, files.length) }, worker));
  return out;
}

/** Serialize the given templates (+ referenced files) into a `.sqemes.zip` blob. */
export async function exportTemplatesToZip(templates: Prompt[], allFiles: WorkspaceFile[]): Promise<Blob> {
  return (await buildBundle(templates, allFiles)).blob;
}

/** Like exportTemplatesToZip but also returns the manifest (for a preview / listing metadata). */
export async function buildBundle(
  templates: Prompt[],
  allFiles: WorkspaceFile[],
  /**
   * SQEM-330 — personas to carry along. ⚠️ **The caller must already have added their attached
   * templates to `templates`**; this function maps routes onto whatever refs exist and drops the
   * rest. That is the safe direction — a route pointing at a template the bundle does not contain
   * would import as a route to nothing, which is the one thing a persona must never have.
   */
  personas: Persona[] = [],
): Promise<{ blob: Blob; manifest: BundleManifest }> {
  const zip = new JSZip();
  const fileById = new Map(allFiles.map(f => [f.id, f]));
  const fileRefs = new Map<string, string>();  // fileId → ref
  const bundleFiles: BundleFile[] = [];

  // SQEM-521 — every referenced file is fetched up front, then refs are assigned in the old traversal
  // order. The fetch used to sit inside this traversal, one `await` per file, so each file was its own
  // `sign-file-url` call and its own download: 60 files took 41 s of a 46 s submission (measured on
  // staging, 2026-10-18). Assigning refs afterwards, skipping files that failed, keeps the manifest
  // identical to the sequential version.
  const wanted = [...new Set(templates.flatMap(t => t.contextFileIds || []))]
    .map(id => fileById.get(id))
    .filter((f): f is WorkspaceFile => !!f); // referenced file deleted/inaccessible → skip (dangling ref pruned)
  const bytes = await fetchFiles(wanted);

  // Zip a referenced file's bytes; dedupe. Returns its ref, or null if it could not be fetched.
  const ensureFile = (fileId: string): string | null => {
    if (fileRefs.has(fileId)) return fileRefs.get(fileId)!;
    const f = fileById.get(fileId);
    const blob = bytes.get(fileId);
    if (!f || !blob) return null;
    const ref = `f${bundleFiles.length + 1}`;
    const path = `files/${ref}__${sanitizeName(f.name)}`;
    zip.file(path, blob);
    fileRefs.set(fileId, ref);
    bundleFiles.push({ ref, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, path });
    return ref;
  };
  const resolveFileRefs = (ids: string[]): string[] => ids.map(ensureFile).filter((r): r is string => !!r);

  const bundleTemplates: BundleTemplate[] = [];
  for (const t of templates) {
    const contextFileRefs = resolveFileRefs(t.contextFileIds || []);
    bundleTemplates.push({
      ref: `t${bundleTemplates.length + 1}`,
      kind: t.kind, title: t.title, description: t.description, tag: t.tag ?? null,
      variables: t.variables || [], content: t.content,
      model: t.model, contextFileRefs,
    });
  }

  // Templates are addressed by bundle ref, so a persona's routes need the id → ref map.
  const refByTemplateId = new Map(templates.map((t, i) => [t.id, bundleTemplates[i]?.ref]).filter(([, r]) => !!r) as [string, string][]);
  const bundlePersonas: BundlePersona[] = personas.map((p, i) => ({
    ref: `p${i + 1}`,
    title: p.title,
    description: p.description,
    content: p.content,
    tags: p.tags || [],
    routes: p.routes
      .map(r => ({ templateRef: refByTemplateId.get(r.templateId), condition: r.condition || '' }))
      .filter((r): r is { templateRef: string; condition: string } => !!r.templateRef),
  }));

  const manifest: BundleManifest = {
    schema: BUNDLE_SCHEMA, exportedAt: new Date().toISOString(), generator: 'sqemes',
    templates: bundleTemplates, files: bundleFiles,
    // Omitted entirely when there are none, so an ordinary template export is byte-identical to
    // what it produced before this ticket.
    ...(bundlePersonas.length ? { personas: bundlePersonas } : {}),
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return { blob: await zip.generateAsync({ type: 'blob' }), manifest };
}

/** Trigger a browser download of a blob. */

// ---- Import ----------------------------------------------------------------------------------------

/** Read + validate a `.sqemes.zip` before showing the confirmation preview. */

function buildPrompt(b: BundleTemplate, workspaceId: string, userId: string, contextFileIds: string[], sourceTemplateId?: string): Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'> {
  // SQEM-390 — a pre-2026-09-13 bundle may carry an assistant. It lands as a skill whose body is
  // the old system instruction (the assistant's canonical text), falling back to `content` when
  // there was none — exactly what the database migration did to the rows it found.
  const legacyAssistant = b.kind === 'assistant';
  const kind: PromptKind = legacyAssistant || b.kind === 'skill' ? 'skill' : 'prompt';
  const content = legacyAssistant ? (b.systemInstruction || b.content || '') : (b.content || '');
  return {
    workspaceId,
    kind,
    title: b.title || 'Imported playbook',
    description: b.description || '',
    tag: b.tag ?? null,
    variables: Array.isArray(b.variables) ? b.variables : [],
    content,
    contextFileIds,
    model: b.model,
    createdBy: userId,
    usageCount: 0,
    isFavorite: false,
    published: true,
    ...(sourceTemplateId ? { sourceTemplateId } : {}),
  };
}

/** Apply a validated bundle into a workspace: create files → templates with fresh, remapped ids. */
export async function importBundle(
  zip: JSZip, manifest: BundleManifest, workspaceId: string, userId: string,
  // SQEM-519 — set by a Cloud marketplace copy: every template of the bundle records the listing.
  opts: { sourceTemplateId?: string } = {},
): Promise<{ templates: number; personas: number; files: WorkspaceFile[] }> {
  const fileMap = new Map<string, string>();   // BundleFile.ref → new workspace_files id
  const createdFiles: WorkspaceFile[] = [];

  // SQEM-514 — any file a skill carries; its type comes from the bytes, the manifest's `mimeType` is
  // only what the exporting side believed. If one file fails, the files this import already created
  // are removed again — no template references them yet.
  try {
    for (const bf of manifest.files || []) {
      const entry = zip.file(bf.path);
      if (!entry) continue; // manifest referenced a file not in the zip → skip
      const blob = await entry.async('blob');
      const created = await uploadSkillFile(workspaceId, new File([blob], bf.name), []);
      fileMap.set(bf.ref, created.id);
      createdFiles.push(created);
    }
  } catch (e) {
    await Promise.allSettled(createdFiles.map(f => deleteWorkspaceFile(f.id, f.storagePath)));
    throw e;
  }

  const mapFiles = (refs?: string[]) => (refs || []).map(r => fileMap.get(r)).filter(Boolean) as string[];

  // SQEM-529 — what this run created, by id, so a failure further on can take it back. Until then
  // only the files were removed: an import that created its prompt and then failed on the persona
  // (SQEM-525) left the prompt behind — a retry would have doubled it. Ids, never names:
  // a playbook of the same name that was already in the workspace is not this run's to delete.
  const createdTemplateIds: string[] = [];
  const createdPersonaIds: string[] = [];
  try {
    let templates = 0;
    // SQEM-330 — the created id per bundle ref, so a persona's routes can be re-pointed.
    const templateIdByRef = new Map<string, string>();
    for (const bt of manifest.templates || []) {
      const created = await createPrompt(buildPrompt(bt, workspaceId, userId, mapFiles(bt.contextFileRefs), opts.sourceTemplateId), workspaceId);
      if (created?.id) createdTemplateIds.push(created.id);
      if (created?.id && bt.ref) templateIdByRef.set(bt.ref, created.id);
      templates++;
    }

    // SQEM-330 — personas last, because their routes address templates that must exist first.
    //
    // ⚠️ A route whose template failed to import is **dropped, not kept pointing at nothing.** The
    // persona arrives smaller and honest rather than complete and broken — the same rule the MCP
    // renderer follows when a caller cannot reach a route.
    //
    // ⛔ Access rules are not imported. They name people of the source workspace, and those ids mean
    // nothing here; the persona starts open and whoever imported it decides.
    let personas = 0;
    for (const bp of manifest.personas || []) {
      const routes = (bp.routes || [])
        .map((r, i) => {
          const templateId = templateIdByRef.get(r.templateRef);
          return templateId ? { templateId, condition: r.condition || '', sortOrder: i } : null;
        })
        .filter(Boolean) as { templateId: string; condition: string; sortOrder: number }[];

      // SQEM-529 — the routes are set separately rather than through `createPersona`, which inserts the
      // row and then the routes: a route failure there throws after the row exists, and its id would
      // never reach this function to be taken back.
      const created = await createPersona(
        workspaceId,
        {
          title: bp.title || 'Imported persona',
          description: bp.description || '',
          content: bp.content || '',
          tags: Array.isArray(bp.tags) ? bp.tags : [],
        },
        userId,
      );
      createdPersonaIds.push(created.id);
      if (routes.length) await setPersonaRoutes(created.id, routes);
      personas++;
    }

    return { templates, personas, files: createdFiles };
  } catch (e) {
    throw await undoImport(e, createdPersonaIds, createdTemplateIds, createdFiles);
  }
}

/**
 * SQEM-529 — remove what a failed import created, newest first: personas (their routes go with them,
 * `on delete cascade`), then playbooks, then files — so nothing is deleted while something still
 * points at it. Returns the error to throw: the original one when everything was removed, otherwise
 * one that keeps the original text and says what is still in the workspace.
 */
async function undoImport(
  cause: unknown, personaIds: string[], templateIds: string[], files: WorkspaceFile[],
): Promise<unknown> {
  const failed = (results: PromiseSettledResult<unknown>[]) => results.filter(r => r.status === 'rejected').length;
  const personas = failed(await Promise.allSettled(personaIds.map(id => deletePersona(id))));
  const templates = failed(await Promise.allSettled(templateIds.map(id => deletePrompt(id))));
  const fileCount = failed(await Promise.allSettled(files.map(f => deleteWorkspaceFile(f.id, f.storagePath))));
  const left = ([[personas, 'persona'], [templates, 'playbook'], [fileCount, 'file']] as [number, string][])
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  if (!left.length) return cause;
  return new Error(`${errorMessage(cause, 'Import failed.')} Some imported items could not be removed: ${left.join(', ')}.`);
}
