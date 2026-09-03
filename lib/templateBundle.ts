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
import { createPrompt } from './api/prompts';
import { createPersona } from './api/personas';
import { getWorkspaceFileSignedUrl, uploadWorkspaceFile } from './api/files';


// ---- Export ----------------------------------------------------------------------------------------

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

  // Fetch + zip a referenced file's bytes; dedupe. Returns its ref, or null if it can't be resolved.
  const ensureFile = async (fileId: string): Promise<string | null> => {
    if (fileRefs.has(fileId)) return fileRefs.get(fileId)!;
    const f = fileById.get(fileId);
    if (!f) return null; // referenced file deleted/inaccessible → skip (dangling ref pruned)
    try {
      const resp = await fetch(await getWorkspaceFileSignedUrl(f.storagePath));
      if (!resp.ok) return null;
      const ref = `f${bundleFiles.length + 1}`;
      const path = `files/${ref}__${sanitizeName(f.name)}`;
      zip.file(path, await resp.blob());
      fileRefs.set(fileId, ref);
      bundleFiles.push({ ref, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, path });
      return ref;
    } catch {
      return null;
    }
  };
  const resolveFileRefs = async (ids: string[]): Promise<string[]> => {
    const out: string[] = [];
    for (const id of ids) { const r = await ensureFile(id); if (r) out.push(r); }
    return out;
  };

  const bundleTemplates: BundleTemplate[] = [];
  for (const t of templates) {
    const contextFileRefs = await resolveFileRefs(t.contextFileIds || []);
    bundleTemplates.push({
      ref: `t${bundleTemplates.length + 1}`,
      kind: t.kind, title: t.title, description: t.description, tag: t.tag ?? null,
      variables: t.variables || [], content: t.content, systemInstruction: t.systemInstruction,
      model: t.model, brandConfig: t.brandConfig, contextFileRefs,
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

function buildPrompt(b: BundleTemplate, workspaceId: string, userId: string, contextFileIds: string[]): Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    workspaceId,
    kind: (b.kind || 'prompt') as PromptKind,
    title: b.title || 'Imported template',
    description: b.description || '',
    tag: b.tag ?? null,
    variables: Array.isArray(b.variables) ? b.variables : [],
    content: b.content || '',
    systemInstruction: b.systemInstruction,
    contextFileIds,
    model: b.model,
    createdBy: userId,
    usageCount: 0,
    isFavorite: false,
    published: true,
    brandConfig: b.brandConfig,
  };
}

/** Apply a validated bundle into a workspace: create files → templates with fresh, remapped ids. */
export async function importBundle(
  zip: JSZip, manifest: BundleManifest, workspaceId: string, userId: string,
): Promise<{ templates: number; personas: number; files: WorkspaceFile[] }> {
  const fileMap = new Map<string, string>();   // BundleFile.ref → new workspace_files id
  const createdFiles: WorkspaceFile[] = [];

  for (const bf of manifest.files || []) {
    const entry = zip.file(bf.path);
    if (!entry) continue; // manifest referenced a file not in the zip → skip
    const blob = await entry.async('blob');
    const created = await uploadWorkspaceFile(workspaceId, new File([blob], bf.name, { type: bf.mimeType || 'application/octet-stream' }), []);
    fileMap.set(bf.ref, created.id);
    createdFiles.push(created);
  }

  const mapFiles = (refs?: string[]) => (refs || []).map(r => fileMap.get(r)).filter(Boolean) as string[];

  let templates = 0;
  // SQEM-330 — the created id per bundle ref, so a persona's routes can be re-pointed.
  const templateIdByRef = new Map<string, string>();
  for (const bt of manifest.templates || []) {
    const created = await createPrompt(buildPrompt(bt, workspaceId, userId, mapFiles(bt.contextFileRefs)), workspaceId);
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

    await createPersona(
      workspaceId,
      {
        title: bp.title || 'Imported persona',
        description: bp.description || '',
        content: bp.content || '',
        tags: Array.isArray(bp.tags) ? bp.tags : [],
        routes,
      },
      userId,
    );
    personas++;
  }

  return { templates, personas, files: createdFiles };
}
