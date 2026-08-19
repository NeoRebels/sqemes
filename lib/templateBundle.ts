// SQEM-161 (Phase 1 of SQEM-160) — the serialize + apply core for template portability. Turns templates
// (+ their embedded skills + all referenced context-file bytes) into a portable `.sqemes.zip` bundle, and
// applies a bundle back into a workspace with fresh ids. Client-side (JSZip). Reused later by share links
// (Phase 2) and the UGC marketplace (Phase 3).
import JSZip from 'jszip';
import type { Prompt, PromptKind, WorkspaceFile } from '../types';
// SQEM-258 — the format itself lives in `bundleFormat.ts`, which imports nothing but JSZip. This
// module keeps the two halves that genuinely need the network. Re-exported so no call site moved.
import { BUNDLE_SCHEMA, sanitizeName, readBundle, downloadBlob } from './bundleFormat';
import type { BundleFile, BundleTemplate, BundleManifest } from './bundleFormat';
export { BUNDLE_SCHEMA, readBundle, downloadBlob };
export type { BundleFile, BundleTemplate, BundleManifest };
import { fetchResolvedSkills, createPrompt } from './api/prompts';
import { getWorkspaceFileSignedUrl, uploadWorkspaceFile } from './api/files';


// ---- Export ----------------------------------------------------------------------------------------

/** Serialize the given templates (+ embedded skills + referenced files) into a `.sqemes.zip` blob. */
export async function exportTemplatesToZip(templates: Prompt[], allFiles: WorkspaceFile[]): Promise<Blob> {
  return (await buildBundle(templates, allFiles)).blob;
}

/** Like exportTemplatesToZip but also returns the manifest (for a preview / listing metadata). */
export async function buildBundle(templates: Prompt[], allFiles: WorkspaceFile[]): Promise<{ blob: Blob; manifest: BundleManifest }> {
  const zip = new JSZip();
  const fileById = new Map(allFiles.map(f => [f.id, f]));
  const fileRefs = new Map<string, string>();  // fileId → ref
  const skillRefs = new Map<string, string>(); // skillId → ref
  const bundleFiles: BundleFile[] = [];
  const bundleSkills: BundleTemplate[] = [];

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

  const ensureSkill = async (id: string, title: string, content: string, contextFileIds: string[]): Promise<string> => {
    if (skillRefs.has(id)) return skillRefs.get(id)!;
    const ref = `s${bundleSkills.length + 1}`;
    skillRefs.set(id, ref);
    bundleSkills.push({
      ref, kind: 'skill', title, description: '', tag: null, variables: [], content,
      contextFileRefs: await resolveFileRefs(contextFileIds), skillRefs: [],
    });
    return ref;
  };

  const bundleTemplates: BundleTemplate[] = [];
  for (const t of templates) {
    const contextFileRefs = await resolveFileRefs(t.contextFileIds || []);
    const tSkillRefs: string[] = [];
    if ((t.skillIds || []).length) {
      // Resolve embedded skills across access boundaries (same path the launch flow uses).
      let resolved: { id: string; title: string; content: string; contextFileIds: string[] }[] = [];
      try { resolved = await fetchResolvedSkills(t.id); } catch { /* graceful: export without skills */ }
      for (const s of resolved) tSkillRefs.push(await ensureSkill(s.id, s.title, s.content, s.contextFileIds));
    }
    bundleTemplates.push({
      ref: `t${bundleTemplates.length + 1}`,
      kind: t.kind, title: t.title, description: t.description, tag: t.tag ?? null,
      variables: t.variables || [], content: t.content, systemInstruction: t.systemInstruction,
      model: t.model, brandConfig: t.brandConfig, contextFileRefs, skillRefs: tSkillRefs,
    });
  }

  const manifest: BundleManifest = {
    schema: BUNDLE_SCHEMA, exportedAt: new Date().toISOString(), generator: 'sqemes',
    templates: bundleTemplates, skills: bundleSkills, files: bundleFiles,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return { blob: await zip.generateAsync({ type: 'blob' }), manifest };
}

/** Trigger a browser download of a blob. */

// ---- Import ----------------------------------------------------------------------------------------

/** Read + validate a `.sqemes.zip` before showing the confirmation preview. */

function buildPrompt(b: BundleTemplate, workspaceId: string, userId: string, contextFileIds: string[], skillIds: string[]): Omit<Prompt, 'id' | 'createdAt' | 'updatedAt'> {
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
    skillIds,
    model: b.model,
    createdBy: userId,
    usageCount: 0,
    isFavorite: false,
    published: true,
    brandConfig: b.brandConfig,
  };
}

/** Apply a validated bundle into a workspace: create files → skills → templates with fresh, remapped ids. */
export async function importBundle(
  zip: JSZip, manifest: BundleManifest, workspaceId: string, userId: string,
): Promise<{ templates: number; skills: number; files: WorkspaceFile[] }> {
  const fileMap = new Map<string, string>();   // BundleFile.ref → new workspace_files id
  const skillMap = new Map<string, string>();  // skill ref → new prompt id
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

  for (const bs of manifest.skills || []) {
    const created = await createPrompt(buildPrompt(bs, workspaceId, userId, mapFiles(bs.contextFileRefs), []), workspaceId);
    skillMap.set(bs.ref, created.id);
  }

  let templates = 0;
  for (const bt of manifest.templates || []) {
    const skillIds = (bt.skillRefs || []).map(r => skillMap.get(r)).filter(Boolean) as string[];
    await createPrompt(buildPrompt(bt, workspaceId, userId, mapFiles(bt.contextFileRefs), skillIds), workspaceId);
    templates++;
  }

  return { templates, skills: (manifest.skills || []).length, files: createdFiles };
}
