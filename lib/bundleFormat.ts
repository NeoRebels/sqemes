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
};
// ⚠️ SQEM-298 — `skills` and `skillRefs` are gone from this format, not deprecated.
//
// They carried skills *embedded into another template* via `prompts.skill_ids`, which SQEM-167 took
// out of the editor and SQEM-047 had already emptied by migration on every database that runs the
// chain. The field was therefore always `[]` in anything we ever wrote.
//
// ⛔ **The reader went with the writer**, which is only correct because of a fact the owner
// confirmed on 2026-08-31: **no bundle has ever been downloaded**, so there is no file in the world
// carrying a populated `skills` to be compatible with. Keeping a reader for a shape that was never
// shipped is ceremony. That premise expires — see the note in `templateBundle.ts`.
/**
 * SQEM-330 — a persona in a bundle, with its routes pointing at `BundleTemplate.ref`.
 *
 * ⛔ **A persona cannot travel alone.** It is a set of references to templates; exported without
 * them it is a role description whose every route leads nowhere, and importing it would produce
 * exactly that. So exporting a persona pulls its attached templates (and their context files) into
 * the same bundle, and the routes address them by bundle ref rather than by database id.
 *
 * ⚠️ **Access rules are NOT carried.** `persona_access` names people and groups of *this* workspace;
 * those ids mean nothing in another one. An imported persona starts under the destination
 * workspace's own default, which is the only answer that is not quietly wrong.
 */
export type BundlePersonaRoute = { templateRef: string; condition: string };
export type BundlePersona = {
  ref: string;
  title: string;
  description: string;
  content: string;
  tags: string[];
  routes: BundlePersonaRoute[];
};

export type BundleManifest = {
  schema: string;
  exportedAt?: string;
  generator?: string;
  templates: BundleTemplate[];
  files: BundleFile[];
  /**
   * ⚠️ **Optional, and deliberately not a schema bump.** A bundle written before SQEM-330 has no
   * `personas` key and stays valid — the reader simply finds nothing. Bumping `BUNDLE_SCHEMA` would
   * have announced an incompatibility that does not exist, and forced a version check into every
   * reader for a field they can ignore. Additive beats versioned when it is genuinely additive.
   */
  personas?: BundlePersona[];
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
