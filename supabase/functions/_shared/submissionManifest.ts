// SQEM-493 — the one reader of a marketplace submission's manifest, shared by `marketplace-submit`
// (self-host publishers) and `marketplace-submit-cloud` (Cloud workspaces). Import-free on purpose,
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
