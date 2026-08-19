// SQEM-258 — the `.sqemes.zip` **format**: its schema, its types, and reading one. No network, no
// Supabase, no `lib/api/*`.
//
// ⚠️ **Split out of `templateBundle.ts` because that module imports `lib/api/*` → `lib/supabase`,
// which throws at load time without env vars.** Anything importing it inherits that — including the
// public listing page, which must not touch the store at all, and any test, which then passes only
// where a `.env.local` happens to sit. CI caught exactly this, for the second time in the same
// module family: `skillBundleIo.ts` records the first (SQEM-243), and its lesson was the same one
// applied here — **a test that needs no stand-in is testing the module rather than the stand-in.**
//
// Writing a bundle (`buildBundle`) and applying one (`importBundle`) stay in `templateBundle.ts`:
// they genuinely need the network. It re-exports everything below, so existing imports are unchanged.
import JSZip from 'jszip';
import type { PromptKind, Variable, AssistantBrandConfig } from '../types';

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

export const sanitizeName = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';

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
