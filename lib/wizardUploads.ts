// SQEM-315/316 — the wizard's document plumbing: reading what a person hands over without keeping
// it, and resolving what the model names back to files that actually exist.
//
// ⛔ **The uploaded file is material, not inventory.** It is read in the browser and never sent to
// storage. That is the owner's requirement — "die im Upload hinzugefügte Datei soll nicht permanent
// in Files gespeichert werden" — and *not uploading it* is the only way to keep it: uploading and
// deleting afterwards leaves the file behind on every path that does not reach the delete (cancel,
// a failed generation, a closed tab).

/**
 * Extensions we treat as text when the browser gives us nothing useful.
 *
 * ⚠️ **Browsers routinely report `""` or `application/octet-stream` for `.md`, `.py`, `.ts` and
 * friends** — the MIME type comes from the OS registry, which knows about Word and not about
 * Markdown. Judging on MIME alone would reject exactly the documents this feature is for.
 */
const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'php',
  'sh', 'sql', 'css', 'scss', 'ini', 'toml', 'conf', 'log', 'rst', 'tex',
];

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = [
  'application/json', 'application/xml', 'application/yaml', 'application/x-yaml',
  'application/javascript', 'application/x-sh', 'application/sql',
];

/**
 * Can this file be read as text?
 *
 * ⛔ **The alternative to asking is what the wizard did before: it did not ask.** `readAttachments`
 * ran `res.text()` over everything and kept whatever was non-empty — so a PDF arrived at the model
 * as decoded binary. Its own comment claimed *"binaries are skipped rather than failing"*, which
 * was never true. **Mojibake is worse than a refusal**: the refusal can be read and acted on, the
 * mojibake silently degrades the result and looks like the model being bad at its job.
 */
export function isReadableAsText(file: { name: string; type?: string }): boolean {
  const mime = (file.type || '').toLowerCase();
  if (TEXT_MIME_PREFIXES.some(p => mime.startsWith(p))) return true;
  if (TEXT_MIME_EXACT.includes(mime)) return true;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return ext !== file.name.toLowerCase() && TEXT_EXTENSIONS.includes(ext);
}

/** Read a File's text in the browser. Never touches the network. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error(`${file.name} could not be read.`));
    r.readAsText(file);
  });
}

/**
 * Resolve filenames the model returned back to real workspace files.
 *
 * ⛔ **This is a filter, never a lookup, and the difference is the security property.** `visible` is
 * the client's own file list — a plain `select('*')` that RLS has already narrowed to what this
 * person may see. A name that is not in it is **discarded**; it is never used to go and fetch
 * anything. A model that hallucinates a filename, or repeats one it saw in a document from another
 * team, must not thereby cause a read.
 *
 * ⚠️ Names are not unique in `workspace_files` (no constraint on `(workspace_id, name)`, see
 * SQEM-251) — so a name can match more than one row, and all matches are returned. That is the
 * honest behaviour: picking one arbitrarily would attach a file nobody chose.
 */
export function resolveVisibleFiles<T extends { id: string; name: string }>(
  names: string[],
  visible: T[],
): T[] {
  if (!names.length) return [];
  const wanted = new Set(names);
  return visible.filter(f => wanted.has(f.name));
}


// ---- Binary documents (SQEM-316) ----------------------------------------------------------------

/**
 * Providers whose `execute-step` branch actually forwards a PDF.
 *
 * ⛔ **This mirrors `supabase/functions/execute-step/index.ts` and must be changed with it.**
 * Verified against the providers' own docs on 2026-09-01:
 *
 * | provider | how it takes a PDF |
 * |---|---|
 * | gemini | `inlineData` passed straight through |
 * | openai | `type: 'file'` with `file_data` |
 * | claude | `type: 'document'`, base64 |
 * | mistral | `type: 'document_url'` with a `data:application/pdf;base64,…` URI |
 * | openrouter | `type: 'file'`; works on **any** model there — OpenRouter parses server-side when the model itself cannot |
 * | **grok** | ⛔ images only, documents explicitly unsupported |
 * | **deepseek** | ⛔ Chat Completions takes text; no file part exists in the schema |
 *
 * ⚠️ **`sqemes` is the funded model — Mistral under our own key — so it belongs here too.** That
 * matters more than it looks: a workspace on funded credits has *no* provider key, so "choose a
 * model that can read PDFs" would be advice it cannot act on.
 *
 * ⛔ **Two of these were wrong until SQEM-316**, and the reason is worth keeping: the filter came in
 * with the initial commit in February 2026, carried no justification, and nobody dated it. **An
 * assumption about somebody else's API goes stale in silence** — the request still succeeded, the
 * model still answered, and the document simply was not there.
 */
export const PDF_CAPABLE_PROVIDERS = ['gemini', 'openai', 'claude', 'mistral', 'openrouter', 'sqemes'] as const;

/** Images survive every branch — `callOpenAICompatible` sends them as `image_url`. */
const IMAGE_MIME_PREFIX = 'image/';

/**
 * ⚠️ **Well under `execute-step`'s 20 MB body limit, because base64 inflates by ~33 %** and the
 * prompt text rides along in the same request. Enforced when the file is picked: finding out after
 * a minute of generation that the document was too large is the expensive way to learn it.
 */
export const MAX_BINARY_BYTES = 12 * 1024 * 1024;

export type UploadRejection = { name: string; reason: string };

/** What a readable upload becomes: text inline, or a base64 part for the model. */
export type UploadedDoc =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'binary'; name: string; mimeType: string; data: string };

/**
 * Decide what can be done with a picked file, given the provider that will read it.
 *
 * Returns the reason for a refusal rather than a boolean, because **a refusal without a reason is
 * the thing this feature keeps getting wrong**: SQEM-315 refused every PDF with a sentence about
 * gibberish that was true of the old code and false of the model.
 */
export function classifyUpload(
  file: { name: string; type?: string; size?: number },
  provider: string | null,
): { ok: true; binary: boolean } | { ok: false; reason: string } {
  if (isReadableAsText(file)) return { ok: true, binary: false };

  const mime = (file.type || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isImage = mime.startsWith(IMAGE_MIME_PREFIX);
  if (!isPdf && !isImage) {
    return { ok: false, reason: `${file.name} isn't a text document, a PDF or an image, so there is no way to read it here.` };
  }
  if ((file.size ?? 0) > MAX_BINARY_BYTES) {
    return { ok: false, reason: `${file.name} is larger than ${Math.round(MAX_BINARY_BYTES / 1024 / 1024)} MB, which is more than the model request can carry.` };
  }
  if (isPdf && !(PDF_CAPABLE_PROVIDERS as readonly string[]).includes(provider ?? '')) {
    return {
      ok: false,
      // ⛔ The one place in the product where "choose a different model" is honest advice: the limit
      // is structural — this provider has no way to accept a document at all — not a passing 503.
      // SQEM-310 had to withdraw that sentence because the setting did not exist; SQEM-311 built it.
      reason: `${file.name} is a PDF, and ${provider ?? 'the selected provider'} has no way to accept a document — it would be dropped without a word and the template written as if you had attached nothing. Pick a Gemini, OpenAI, Claude, Mistral or OpenRouter model under Settings → General → AI for authoring.`,
    };
  }
  return { ok: true, binary: true };
}

/** Read a File as base64 (no data: prefix), for an `inlineData` part. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result ?? '');
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error(`${file.name} could not be read.`));
    r.readAsDataURL(file);
  });
}


// ---- Naming what the model wrote (SQEM-318) ------------------------------------------------------

/**
 * Turn a filename the model invented into one the workspace can hold.
 *
 * The model names the file — the owner's decision, and a good one: it knows what it wrote. What it
 * does not know is our file model, so three things are imposed rather than trusted.
 *
 * ⛔ **Path segments are stripped.** `references/tone.md` would be read as a folder by `folderOf`
 * and would claim a structure nobody asked for — the exact confusion SQEM-251 had to untangle when
 * two imported skills merged their `references/` directories.
 *
 * ⛔ **The extension is forced to `.md`.** The content is markdown by construction; a model naming
 * it `tone.txt` would leave a file whose name disagrees with its bytes.
 *
 * ⚠️ **Collisions get a suffix, because the database will not stop them.** `workspace_files` has no
 * unique constraint on `(workspace_id, name)` (SQEM-251). Two wizard runs would otherwise leave two
 * `brand-voice.md` in the library, distinguishable only through `context_file_ids` — which the Files
 * page does not show. **Two files with one name is worse than an ugly name.**
 */
export function generatedFileName(raw: string, taken: string[]): string {
  const base = (raw.split(/[/\\]/).pop() ?? '').trim() || 'context';
  const stem = base.replace(/\.[^.]+$/, '') || 'context';
  // ⚠️ Filtered by code point rather than a character-class range: a regex containing control
  // characters trips `no-control-regex`, which is an ESLint **error** here and fails CI. Explicit
  // is also clearer — and a range like `[^\x20-\x7e]` would have quietly eaten umlauts.
  const safe = [...stem]
    .filter(c => (c.codePointAt(0) ?? 0) >= 0x20 && !'<>:"|?*'.includes(c))
    .join('')
    .replace(/^\.+/, '')
    .trim() || 'context';
  const used = new Set(taken.map(t => t.toLowerCase()));
  let candidate = `${safe}.md`;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${safe} (${i}).md`;
  return candidate;
}
