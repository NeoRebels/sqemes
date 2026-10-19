// SQEM-493 — the one reader of a marketplace submission's manifest, shared by `marketplace-submit`
// (self-host publishers) and `marketplace-submit-cloud` (Cloud workspaces). Imports nothing,
// so the unit tests can load it; the callers unzip, this decides what the listing says.
//
// ⛔ The listing's text, hash and scan come from the BUNDLE, never from the request body: the bundle
// is what "Add to workspace" imports, so it is the thing that has to be scanned and deduplicated.

export const BUNDLE_SCHEMA = 'sqemes-bundle/v1';
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024; // 5 MB compressed
export const MAX_ENTRIES = 300;

export interface SubmissionTemplate {
  kind: 'prompt' | 'skill';
  title: string;
  description: string;
  tag: string | null;
  variables: unknown[];
  content: string;
}

export type ManifestResult =
  | { ok: true; template: SubmissionTemplate; fileNames: string[] }
  | { ok: false; error: string };

export function parseSubmissionManifest(manifestJson: string): ManifestResult {
  let manifest: {
    schema?: string;
    // systemInstruction: legacy, read only (SQEM-390)
    templates?: { kind: string; title: string; description?: string; tag?: string | null; variables?: unknown[]; content: string; systemInstruction?: string }[];
    files?: { name: string }[];
  };
  try { manifest = JSON.parse(manifestJson); } catch { return { ok: false, error: 'Corrupt manifest' }; }
  if (!manifest || manifest.schema !== BUNDLE_SCHEMA) {
    return { ok: false, error: `Unsupported bundle version: ${manifest?.schema ?? 'unknown'}` };
  }

  const raw = (manifest.templates || [])[0];
  if (!raw || !raw.title?.trim() || raw.content == null) return { ok: false, error: 'Bundle has no primary template' };
  // SQEM-390 — a bundle written before the assistant kind was retired lands as a skill whose body
  // is the old system instruction: the same rule the importer and the migration apply.
  const tpl = raw.kind === 'assistant'
    ? { ...raw, kind: 'skill', content: raw.systemInstruction || raw.content }
    : raw;
  if (tpl.kind !== 'prompt' && tpl.kind !== 'skill') return { ok: false, error: `Unknown template kind: ${tpl.kind}` };

  return {
    ok: true,
    template: {
      kind: tpl.kind,
      title: tpl.title.trim(),
      description: tpl.description ?? '',
      tag: tpl.tag ?? null,
      variables: Array.isArray(tpl.variables) ? tpl.variables : [],
      content: String(tpl.content),
    },
    fileNames: (manifest.files || []).map(f => f.name),
  };
}

/** Same shape as the Cloud and self-host dedup always used: title, description, content. */
export async function submissionContentHash(t: Pick<SubmissionTemplate, 'title' | 'description' | 'content'>): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${t.title} ${t.description} ${t.content}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A Cloud bundle must sit in the submitting workspace's folder, in the shape the app uploads. */
export function isCloudBundlePath(path: unknown, workspaceId: string): path is string {
  return typeof path === 'string'
    && !path.includes('..')
    && new RegExp(`^${workspaceId.replace(/[^0-9a-f-]/gi, '')}/[0-9a-f-]{36}/bundle\\.sqemes\\.zip$`, 'i').test(path);
}

// SQEM-519 — every file of a bundle, as the review sees it: its bytes, under the name the person gave
// it (the manifest maps `files/<ref>__<name>` back to that name). Every ZIP entry is reviewed, not just
// the ones the manifest lists — the manifest is written by the submitting client and can omit files.
type ZipLike = { files: Record<string, { dir: boolean; name: string; async(t: 'uint8array' | 'string'): Promise<any> }> };

export async function bundleReviewInputs(zip: ZipLike): Promise<{ path: string; bytes: Uint8Array }[]> {
  const names = new Map<string, string>();
  const manifestEntry = zip.files['manifest.json'];
  if (manifestEntry) {
    try {
      const m = JSON.parse(await manifestEntry.async('string'));
      for (const f of Array.isArray(m?.files) ? m.files : []) if (f?.path && f?.name) names.set(String(f.path), String(f.name));
    } catch { /* an unreadable manifest is refused by parseSubmissionManifest; review the bytes anyway */ }
  }
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || entry.name === 'manifest.json') continue;
    const shown = names.get(entry.name) ?? entry.name.replace(/^files\//, '').replace(/^[^_]*__/, '');
    out.push({ path: shown, bytes: await entry.async('uint8array') });
  }
  return out;
}

// SQEM-519 (b) — the bundle's fingerprint: every ZIP entry by its path and SHA-256, `manifest.json`
// included. The manifest carries the templates, their variables and any personas, so a fingerprint of
// the files alone would let a swapped manifest add a template or a persona without changing the hash.
// Written by the submit functions into `bundle_hash`; checked by the copier against the bytes it
// downloaded, before anything is imported. Paths are the raw ZIP paths — what the importer reads.
export async function bundleHashOfZip(zip: ZipLike): Promise<string> {
  const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
    .map(x => x.toString(16).padStart(2, '0')).join('');
  const lines: string[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    lines.push(`${await hex(await entry.async('uint8array'))}  ${entry.name}`);
  }
  lines.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
  return hex(new TextEncoder().encode(lines.join('\n')));
}

/** The copier's check: `null` when the listing predates the hash (nothing to compare). */
export async function bundleMatches(zip: ZipLike, expected: string | null | undefined): Promise<boolean> {
  return !expected || (await bundleHashOfZip(zip)) === expected;
}
