// SQEM-161 (Phase 1 of SQEM-160) — the serialize + apply core for template portability. Turns templates
// (+ their embedded skills + all referenced context-file bytes) into a portable `.sqemes.zip` bundle, and
// applies a bundle back into a workspace with fresh ids. Client-side (JSZip). Reused later by share links
// (Phase 2) and the UGC marketplace (Phase 3).
import JSZip from 'jszip';
import type { Prompt, PromptKind, Variable, WorkspaceFile, AssistantBrandConfig } from '../types';
import { fetchResolvedSkills, createPrompt } from './api/prompts';
import { getWorkspaceFileSignedUrl, uploadWorkspaceFile } from './api/files';

export const BUNDLE_SCHEMA = 'sqemes-bundle/v1';
const MAX_BUNDLE_FILES = 100;
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024; // 200 MB total (zip-bomb guard)

// Bundle-local ids (`t1`/`s1`/`f1`) decouple the portable format from DB ids.
export type BundleFile = { ref: string; name: string; mimeType: string; sizeBytes: number; path: string };
export type BundleTemplate = {
  ref: string;
  kind: PromptKind;
  title: string;
  description: string;
  tag: string | null;
  variables: Variable[];
  content: string;
  systemInstruction?: string;
  model?: string;
  brandConfig?: AssistantBrandConfig;
  contextFileRefs: string[]; // → BundleFile.ref
  skillRefs: string[];       // → BundleTemplate.ref in `skills`
};
export type BundleManifest = {
  schema: string;
  exportedAt?: string;
  generator?: string;
  templates: BundleTemplate[];
  skills: BundleTemplate[];
  files: BundleFile[];
};

const sanitizeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';

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
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Import ----------------------------------------------------------------------------------------

/** Read + validate a `.sqemes.zip` before showing the confirmation preview. */
export async function readBundle(zipFile: File): Promise<{ zip: JSZip; manifest: BundleManifest }> {
  const zip = await JSZip.loadAsync(zipFile);
  const entry = zip.file('manifest.json');
  if (!entry) throw new Error('Not a Sqemes bundle (manifest.json missing).');
  let manifest: BundleManifest;
  try { manifest = JSON.parse(await entry.async('string')); } catch { throw new Error('Corrupt bundle (invalid manifest).'); }
  if (manifest.schema !== BUNDLE_SCHEMA) throw new Error(`Unsupported bundle version: ${manifest.schema ?? 'unknown'}.`);
  const files = manifest.files || [];
  if (files.length > MAX_BUNDLE_FILES) throw new Error(`Bundle has too many files (${files.length}, max ${MAX_BUNDLE_FILES}).`);
  if (files.reduce((s, f) => s + (f.sizeBytes || 0), 0) > MAX_BUNDLE_BYTES) throw new Error('Bundle exceeds the size limit.');
  return { zip, manifest };
}

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
