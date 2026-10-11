/**
 * SQEM-373 — the read half of the template library, in ONE place.
 *
 * ⛔ **These handlers must never be copied.** They were written for `mcp-server` and now serve
 * `chat-message` as well; a second implementation would be the fourth twin in this repo after the
 * three CI workflows and `callOpenAICompatible`, and the drift would be invisible — an access rule
 * fixed on one surface and left standing on the other is a security bug that reads like a feature
 * gap. `mcp-server` imports from here; it does not keep a copy.
 *
 * ⚠️ **Access is answered per caller, not per surface.** The reader is built around a `userId` and
 * resolves what that person may see, once. MCP passes the key owner's id (SQEM-346 — every key is a
 * person's), Chat passes the signed-in user's id. Neither surface gets a way to skip the filter, and
 * there is deliberately no "service" or "no user" branch: SQEM-346 removed the last one, and the
 * note it left behind says why a future service identity must not simply reinstate it.
 *
 * ⭐ Everything here returns **plain data**. The JSON-RPC envelope belongs to `mcp-server` and the
 * tool-result shape to `chat-message`; putting either in here would have forced the other surface to
 * unwrap it. The seam is exactly where the old handlers already had it — they built a `result`
 * object and then wrapped it in the very last line.
 */

/** SQEM-492 — a storage path belongs to a workspace only if it sits in that workspace's folder. */
export const isPathInWorkspace = (path: string | null | undefined, workspaceId: string): boolean =>
  typeof path === 'string' && !!workspaceId && path.startsWith(`${workspaceId}/`) && !path.includes('..');

// ── Errors ──────────────────────────────────────────────────────────────────
//
// Two of them, because the two callers map them to different things and a single opaque Error would
// have made both guess. `mcp-server` turns both into `rpcError(-32602)`; `chat-message` turns them
// into a tool result the model can read and act on.

/** The thing does not exist, or the caller may not see it — deliberately indistinguishable. */
export class LibraryNotFound extends Error {
  constructor(message: string) { super(message); this.name = 'LibraryNotFound'; }
}

/** The call itself was malformed (missing id and name, an unknown mode). */
export class LibraryBadRequest extends Error {
  constructor(message: string) { super(message); this.name = 'LibraryBadRequest'; }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Title → the stable `name` slug every surface addresses a template by. */
export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Mimes whose stored bytes are textual content (inlined directly). Everything else
// (PDF, images) is binary — referenced by resource URI for the client to fetch.
export function isTextContentMime(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/toml'
    || mime === 'application/sql';
}

// Chunk-safe base64 — spreading a large Uint8Array into String.fromCharCode overflows the stack.
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ---- SQEM-230 — previews for include_files: "list" ----

const PREVIEW_HEADING_LIMIT = 40;
const PREVIEW_CHAR_LIMIT    = 500;

// Builds the preview that decides whether a caller bothers to fetch a file at all.
//
// A bare filename is not enough: the caller cannot tell whether the fetch is worth it, so it fetches
// everything — which costs what inlining costs, plus round-trips. The preview has to carry enough
// shape to answer "is what I need in here?".
//
// Markdown gets its heading outline, because that IS the table of contents of a knowledge file.
// Everything else falls back to the opening characters. Markdown is detected by mime alone, which is
// safe here: BOTH upload paths normalise the extension to a mime before the row is written —
// `lib/api/files.ts` via `inferTextMime()`, and `upload_file` via the `TEXT_MIME` map. A `.md` is
// always stored as `text/markdown`, never as `application/octet-stream`.
export function buildPreview(text: string, mimeType: string): { preview: string; truncated: boolean } {
  if (mimeType === 'text/markdown') {
    const headings = text.split('\n').filter(l => /^#{1,2}\s+\S/.test(l)).map(l => l.trim());
    if (headings.length > 0) {
      const kept = headings.slice(0, PREVIEW_HEADING_LIMIT);
      return { preview: kept.join('\n'), truncated: headings.length > kept.length };
    }
    // A markdown file with no h1/h2 — an unstructured note. The outline would be empty and
    // therefore useless, so fall through to the character preview rather than return nothing.
  }
  const slice = text.slice(0, PREVIEW_CHAR_LIMIT);
  return { preview: slice, truncated: text.length > slice.length };
}

/** One context file, resolved from storage. `text` is null for binaries and in `list` mode. */
export interface ResolvedFile {
  id: string;
  name: string;
  mimeType: string;
  uri: string;
  byteSize: number;
  text: string | null;
  /** `list` mode only, text files only (SQEM-481 — read from the row, computed once). */
  preview?: string;
  previewTruncated?: boolean;
}

// SQEM-481 — how many storage downloads one request runs at a time, and how often a failed one is
// retried.
//
// ⛔ **Measured on production after Promotion (45): with eight in flight, 2 of 4 inline loads of a
// 154-file skill lost 58–61 files** — individual downloads failed sporadically, and the failure was
// silent: the file came back as a reference instead of its text, and nothing was logged. The cause
// was found with the log line below: `429 Too many connections issued to the database`. Every storage
// download makes the Storage API run its own query, and parallel downloads exhaust ITS connection
// pool — which is shared by the whole project, so the 429 also reaches other users' storage requests
// while a large inline load runs. Four in flight with retries still lost up to 3 of 151 files and ran
// 20–39 s under load (staging, 10 consecutive loads). Two in flight (SQEM-481). The retries stay as
// the second line, and whatever still fails is logged with the storage's answer.
// ⛔ Do not raise this without re-running that measurement — the cost lands on everyone, not on MCP.
const DOWNLOAD_CONCURRENCY = 2;
const DOWNLOAD_RETRY_DELAYS_MS = [150, 450];

/** The embedded `workspace_file_texts(content)` of a row — PostgREST returns it as an object or a one-element array. */
function storedTextOf(row: any): string | null {
  const e = row?.workspace_file_texts;
  const c = Array.isArray(e) ? e[0]?.content : e?.content;
  return typeof c === 'string' ? c : null;
}

/**
 * Download one storage object as text, retrying a failed attempt. `null` only after every attempt
 * failed — the caller then falls back to a reference, which is still readable via the uri.
 */
async function downloadText(
  client: any, path: string, onError?: (message: string) => void,
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { data: blob, error } = await client.storage.from('workspace-files').download(path);
      if (blob && !error) return await blob.text();
      onError?.(String((error as any)?.statusCode ?? (error as any)?.status ?? '') + ' ' + String(error?.message ?? 'no data'));
    } catch (e) {
      onError?.(`threw: ${(e as Error)?.message}`);
    }
    if (attempt >= DOWNLOAD_RETRY_DELAYS_MS.length) return null;
    await new Promise(r => setTimeout(r, DOWNLOAD_RETRY_DELAYS_MS[attempt]));
  }
}

/** `Promise.all` over `items`, at most `limit` in flight, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Renders resolved context files as prompt text: text inline, binaries as a URI reference.
//
// SQEM-230 — `mode: 'list'` renders text files the same way binaries have always been rendered, by
// reference. The body then names what context exists without carrying it, which is the whole point:
// the caller decides per file whether to spend the tokens.
export function renderContextBlocks(
  resolved: Array<{ name: string; mimeType: string; uri: string; text: string | null }>,
  mode: 'inline' | 'list' = 'inline',
): string[] {
  return resolved.map(f =>
    f.text != null && mode === 'inline'
      ? `[Context: ${f.name}]\n${f.text}`
      : `[Context file: ${f.name} (${f.mimeType}) — read via ${f.uri}]`,
  );
}

// SQEM-324 — a persona, rendered.
//
// ⛔ **Every surface calls this one function**, and that is the point rather than tidiness: a persona
// reachable as an MCP prompt (the human picks it), as an MCP tool, and now as a Chat tool (the model
// loads it mid-conversation) must be the *same* persona. Three renderers would drift, and the drift
// would be invisible.
//
// ⚠️ `routes` arrives ALREADY FILTERED to what this caller may open. Routes they cannot reach are
// omitted, never listed as unavailable: a model that sees a route it cannot fetch does not skip it,
// it invents the contents. Saying less is the safe direction here; saying "restricted" is not.
export function composePersona(
  persona: { title: string; description: string; content: string },
  routes: { name: string; title: string; kind: string; condition: string; description: string }[],
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`persona: ${persona.title}`);
  if (persona.description) lines.push(`description: ${persona.description}`);
  lines.push('---');
  lines.push('');
  if (persona.content.trim()) {
    lines.push(persona.content.trim());
    lines.push('');
  }

  if (routes.length) {
    lines.push('## Routes — load one only when its condition applies');
    lines.push('');
    lines.push('| When | Load |');
    lines.push('|---|---|');
    for (const r of routes) {
      // The condition is prose for the model to judge; the right-hand side is the exact call to
      // make. Naming the tool beats naming the template: the model needs the verb, not a noun it
      // then has to guess a call for.
      // ⛔ **An empty condition falls back to the template's own description, not to a stub.**
      // SQEM-324 shipped with `the task matches "<title>"` here, which is a sentence that carries no
      // information the title did not already carry — it made the empty case useless and pushed the
      // author into writing a condition for every route, most of which would have restated the
      // description anyway.
      //
      // ⚠️ The fallback resolves **at render time**, so it is always the current description. A
      // condition copied into the column at attach time would have gone stale the moment somebody
      // improved the template's description — and nothing would have said so.
      const when = (r.condition || r.description || `the task matches "${r.title}"`).replace(/\|/g, '\\|');
      lines.push(`| ${when} | \`get_template(name: "${r.name}")\` — ${r.kind} “${r.title}” |`);
    }
    lines.push('');
    lines.push('**Load nothing until a condition applies, and load only the one that does.** Loading');
    lines.push('every route defeats the purpose of this document: it exists so the knowledge arrives');
    lines.push('when it is needed rather than all at once. If nothing fits, ask instead of guessing.');
  } else {
    // A persona whose routes are all invisible to this caller. It still has a role and rules, and
    // those are worth having — but it must not imply that anything is loadable.
    lines.push('_This persona currently has no routes available to you._');
  }

  return lines.join('\n');
}

/**
 * SQEM-326 — a persona this caller should not be offered at all.
 *
 * ⛔ **Only when it HAS routes and none of them survive the filter.** A persona with no routes at
 * all is a role description, which is a legitimate thing to hand somebody — its author knows it is
 * empty. A persona whose seven routes all belong to templates this caller cannot open is different:
 * it advertises a capability it cannot deliver, and the model would work from a role description
 * while believing it has knowledge behind it.
 *
 * Hiding beats listing-with-a-note, for the same reason unreachable routes are omitted rather than
 * marked: a model told "this exists but you may not have it" reaches for it anyway.
 */
export function hiddenFromCaller(v: { total: number; visible: number } | undefined): boolean {
  return !!v && v.total > 0 && v.visible === 0;
}

// ── Shapes returned to the callers ──────────────────────────────────────────

export interface TemplateSummary {
  id: string;
  name: string;
  title: string;
  kind: string;
  description: string;
  argumentCount?: number;
  contextFileCount?: number;
  contextBytes?: number;
}

export interface TemplateDetail {
  id: string;
  name: string;
  title: string;
  kind: string;
  description: string;
  content: string;
  argumentCount: number;
  variables: { name: string; label: string; type: string }[];
  contextFiles: Array<Record<string, unknown>>;
}

export interface PersonaSummary {
  id: string;
  name: string;
  title: string;
  description: string;
  routeCount: number;
}

export interface PersonaRow { id: string; title: string; description: string; content: string }

export interface FileContent {
  uri: string;
  name: string;
  mimeType: string;
  /** Set for text mimes; null for binaries. */
  text: string | null;
  /** Set for binaries; null for text. */
  base64: string | null;
}

// ── The reader ──────────────────────────────────────────────────────────────

export interface LibraryReader {
  canAccessTemplate(id: string): boolean;
  canAccessPersona(id: string): boolean;
  canAccessFile(id: string): boolean;

  listTemplates(args?: { kind?: string | null }): Promise<TemplateSummary[]>;
  searchTemplates(args: { query: string; kind?: string | null }): Promise<TemplateSummary[]>;
  getTemplate(args: { id?: string; name?: string; includeFiles?: string }): Promise<TemplateDetail>;

  listPersonas(): Promise<PersonaSummary[]>;
  getPersona(args: { id?: string; name?: string }): Promise<{ text: string; routeCount: number }>;
  /** Render an already-fetched persona row. Used by `prompts/get`, which resolves the row itself. */
  renderPersona(persona: PersonaRow): Promise<{ text: string; routeCount: number }>;
  routeVisibility(personaIds: string[]): Promise<Map<string, { total: number; visible: number }>>;

  /** Accepts a bare file id or a `sqemes://files/<id>` uri. */
  readContextFile(ref: string): Promise<FileContent>;
  resolveContextFiles(fileIds: string[] | null | undefined, opts?: { mode?: 'inline' | 'list' }): Promise<ResolvedFile[]>;
}

export interface LibraryReaderOptions {
  /** A service-role client. Access is enforced by the sets below, never by the client's identity. */
  client: any;
  workspaceId: string;
  /** The **person** this reader answers for. There is no "no user" mode; see the module header. */
  userId: string;
}

/**
 * Resolves the caller's access once, then answers library reads against it.
 *
 * ⚠️ The three access sets cost one database call (SQEM-500) and are built eagerly, because every
 * one of them is needed by at least one handler and a lazy build would have made the first call of a session
 * pay a different price than the rest — which is exactly the kind of variance that gets mistaken for
 * a slow query later. `mcp-server` already built all three per request before this module existed.
 */
export async function createLibraryReader(
  { client, workspaceId, userId }: LibraryReaderOptions,
): Promise<LibraryReader> {
  // SQEM-500 — the three access sets in ONE database call. SQEM-481 ran four lookups concurrently;
  // under load that still meant four requests queueing for PostgREST's share of the connections, and
  // the queue was where the time went (staging, 100 concurrent: ~7× per query, Postgres idle). The
  // rules did not move: `library_access_sets()` delegates to `mcp_accessible_template_ids` and
  // `mcp_accessible_persona_ids`, and its file clause is the SQEM-291 rule below.
  //
  // ⚠️ A failed call yields EMPTY sets — the reader then sees nothing, which is the closed direction.
  const { data: sets } = await client.rpc('library_access_sets', { p_workspace_id: workspaceId, p_user_id: userId });
  const accessSets = (sets ?? {}) as { templates?: { id: string; title: string }[]; personas?: string[]; files?: string[] };

  const accessibleTemplates = new Set((accessSets.templates ?? []).map(t => t.id));
  const canAccessTemplate = (templateId: string): boolean => accessibleTemplates.has(templateId);
  // name → id over the templates this caller may open; `get_template(name:)` resolves here instead of
  // reading every title in the workspace again.
  const templateIdBySlug = new Map<string, string>();
  for (const t of accessSets.templates ?? []) {
    const slug = toSlug(t.title);
    if (!templateIdBySlug.has(slug)) templateIdBySlug.set(slug, t.id);
  }

  const accessiblePersonas = new Set(accessSets.personas ?? []);
  const canAccessPersona = (personaId: string): boolean => accessiblePersonas.has(personaId);

  // SQEM-291 — which files this caller may read **by id**, which is not answered by the line above.
  //
  // `resolveContextFiles` is safe already: it only ever runs for a template the caller reached, so
  // the file rides along with something they may see. Reading a file by id is not — it addresses the
  // whole workspace, so without this a caller could enumerate the names of every file in it and read
  // any of them, including those attached to templates they cannot open.
  //
  // Enumeration is the sharper half: nobody asked for that list, and a file name alone can be the
  // disclosure ("Q3-layoffs.xlsx").
  //
  // Computed in `library_access_sets()` since SQEM-500: files attached to a template the caller may
  // open, plus files they uploaded (the uploader clause mirrors `can_access_file()`).
  const accessibleFileIds = new Set<string>(accessSets.files ?? []);

  // Resolves context files from storage (source of truth — no longer extracted_text).
  // Text files carry their content; binaries carry only a resource URI to fetch.
  //
  // SQEM-481 — `mode: 'list'` downloads nothing it does not have to. The preview is stored on the
  // row (`workspace_files.preview`) the first time it is computed, so a listing reads one query
  // instead of one download per file. Measured before: `design_diagrams` (154 files) took 12 s at
  // p50 in list mode — slower than most clients wait — although it returned only 174 KB.
  //
  // ⚠️ The stored preview is valid because a file's bytes never change after upload: the app has no
  // replace path, `storage_path` is not client-writable (SQEM-492) and the bucket has no UPDATE
  // policy. An editor who deletes the storage object and re-uploads different bytes under the same
  // path would leave the preview stale; it is a hint for "is this worth reading?", never content
  // and never an access decision, so that is accepted rather than paid for with a check per file.
  // ⚠️ A file whose download fails keeps `preview` null and is retried on the next listing.
  const resolveContextFiles = async (
    fileIds: string[] | null | undefined,
    { mode = 'inline' }: { mode?: 'inline' | 'list' } = {},
  ): Promise<ResolvedFile[]> => {
    if (!fileIds?.length) return [];
    // SQEM-500 — `inline` reads the stored text in the same query (an embedded join on
    // `workspace_file_texts`); `list` does not, because it needs only the preview and the text would
    // be megabytes of payload for nothing.
    const { data: files } = await client
      .from('workspace_files')
      .select(mode === 'list'
        ? 'id, name, mime_type, size_bytes, storage_path, preview, preview_truncated'
        : 'id, name, mime_type, size_bytes, storage_path, workspace_file_texts(content)')
      .eq('workspace_id', workspaceId)
      .in('id', fileIds);

    const rows = (files || []) as any[];
    const toFill: { id: string; preview: string; truncated: boolean }[] = [];
    const toStore: { file_id: string; workspace_id: string; content: string }[] = [];

    // `list` with a preview still missing: its text may be stored already (an earlier inline read).
    const storedText = new Map<string, string>();
    for (const f of rows) {
      const t = storedTextOf(f);
      if (t != null) storedText.set(f.id, t);
    }
    if (mode === 'list') {
      const missing = rows.filter(f => isTextContentMime(f.mime_type) && typeof f.preview !== 'string').map(f => f.id);
      if (missing.length) {
        const { data: texts } = await client.from('workspace_file_texts').select('file_id, content').in('file_id', missing);
        for (const t of (texts || []) as { file_id: string; content: string }[]) storedText.set(t.file_id, t.content);
      }
    }

    // Concurrent, bounded: the old loop awaited each download in turn, so 154 files cost 154 round
    // trips end to end. See DOWNLOAD_CONCURRENCY for why it is four and not more.
    let failed = 0;
    // The distinct storage errors seen in this request, for the log line — the cause of the SQEM-481
    // regression was invisible precisely because nothing said what the storage answered.
    const errorKinds = new Map<string, number>();
    const noteError = (m: string) => errorKinds.set(m.trim().slice(0, 120), (errorKinds.get(m.trim().slice(0, 120)) ?? 0) + 1);
    const resolved = await mapLimit(rows, DOWNLOAD_CONCURRENCY, async (f: any): Promise<ResolvedFile> => {
      const base = {
        id: f.id,
        name: f.name,
        mimeType: f.mime_type,
        uri: `sqemes://files/${f.id}`,
        byteSize: f.size_bytes ?? 0,
        text: null as string | null,
      };
      if (!isTextContentMime(f.mime_type)) return base;

      if (mode === 'list' && typeof f.preview === 'string') {
        return { ...base, preview: f.preview, previewTruncated: !!f.preview_truncated };
      }
      // SQEM-492 — a path outside this workspace's folder is never downloaded (defence in depth
      // behind the workspace_files_path_in_workspace constraint).
      let text = storedText.get(f.id) ?? null;
      if (text == null) {
        if (!isPathInWorkspace(f.storage_path, workspaceId)) return base;
        text = await downloadText(client, f.storage_path, noteError);
        if (text == null) { failed++; return base; }
        toStore.push({ file_id: f.id, workspace_id: workspaceId, content: text });
      }
      if (mode === 'inline') return { ...base, text };

      const { preview, truncated } = buildPreview(text, f.mime_type);
      toFill.push({ id: f.id, preview, truncated });
      return { ...base, preview, previewTruncated: truncated };
    });

    if (failed || errorKinds.size) {
      const kinds = [...errorKinds].map(([m, c]) => `${c}× "${m}"`).join('; ');
      console.error(`[library] ${failed} of ${rows.length} context file downloads failed after retries — returned by reference (mode ${mode}). Attempts failed: ${kinds}`);
    }

    // SQEM-500 — store what had to be downloaded, so the next read of these files needs no storage
    // at all. One batched request; a conflict means a concurrent read stored it first.
    if (toStore.length) {
      try {
        await client.from('workspace_file_texts').upsert(toStore, { onConflict: 'file_id', ignoreDuplicates: true });
      } catch (e) {
        console.error('[library] text write-back failed:', (e as Error)?.message);
      }
    }

    // Write the computed previews back. Awaited, because an un-awaited promise can be torn down with
    // the response; they run concurrently and only ever on the first listing of a file.
    // `.is('preview', null)` keeps a concurrent first listing from writing twice for nothing.
    if (toFill.length) {
      await Promise.all(toFill.map(async ({ id, preview, truncated }) => {
        try {
          await client
            .from('workspace_files')
            .update({ preview, preview_truncated: truncated })
            .eq('workspace_id', workspaceId)
            .eq('id', id)
            .is('preview', null);
        } catch (e) {
          // Best effort: a failed write costs the next listing a download, never this answer.
          console.error('[library] preview write-back failed:', (e as Error)?.message);
        }
      }));
    }
    return resolved;
  };

  // ---- SQEM-232 — context-file stats for list_templates / search_templates ----
  //
  // SQEM-230 gave get_template an `include_files: "list"` mode, but a caller had no way to know it
  // was worth using: neither list_templates nor search_templates said anything about attached files.
  // The decision had to be made before the information existed. These two numbers close that gap.
  //
  // Measured on production 2026-08-16 before choosing the query shape: 44 files in the workspace, 42
  // of them referenced by some template, 78 templates of which 18 carry files. Fetching every file's
  // id+size for the workspace is therefore ~44 rows (~2 KB) and simpler than assembling an id union
  // that would select almost the same rows anyway. **If a workspace ever holds thousands of files
  // with only a handful attached, switch to `.in()` over the union of context_file_ids** — the
  // tradeoff flips there, and this comment is the reason it was not written that way from the start.
  const contextFileStats = async (
    templates: Array<{ id: string; context_file_ids: string[] | null }>,
  ): Promise<Map<string, { count: number; bytes: number }>> => {
    const stats = new Map<string, { count: number; bytes: number }>();
    if (!templates.some(t => t.context_file_ids?.length)) return stats;

    const { data: files } = await client
      .from('workspace_files')
      .select('id, size_bytes')
      .eq('workspace_id', workspaceId);

    const sizeById = new Map<string, number>(
      ((files || []) as Array<{ id: string; size_bytes: number | null }>).map(f => [f.id, f.size_bytes ?? 0]),
    );

    for (const t of templates) {
      const ids = t.context_file_ids ?? [];
      if (!ids.length) continue;
      // Count only ids that actually resolve, so count and bytes describe the same set. A dangling
      // id (file deleted, reference left behind) would otherwise inflate the count while
      // contributing nothing to the size, and the caller would size its decision on a file that
      // cannot be read.
      let count = 0, bytes = 0;
      for (const fid of ids) {
        const size = sizeById.get(fid);
        if (size === undefined) continue;
        count += 1;
        bytes += size;
      }
      if (count > 0) stats.set(t.id, { count, bytes });
    }
    return stats;
  };

  // SQEM-326 — how many routes a persona has, and how many of them THIS caller can open.
  //
  // ⚠️ Batched on purpose. The first cut asked per persona, which is one query per row in
  // `list_personas` and `prompts/list` — a workspace with twenty personas paid twenty round trips to
  // render a menu.
  const routeVisibility = async (personaIds: string[]) => {
    const out = new Map<string, { total: number; visible: number }>();
    for (const pid of personaIds) out.set(pid, { total: 0, visible: 0 });
    if (personaIds.length === 0) return out;

    const { data: rows } = await client
      .from('persona_templates')
      .select('persona_id, template_id')
      .in('persona_id', personaIds);

    for (const r of ((rows as { persona_id: string; template_id: string }[] | null) || [])) {
      const entry = out.get(r.persona_id);
      if (!entry) continue;
      entry.total += 1;
      if (canAccessTemplate(r.template_id)) entry.visible += 1;
    }
    return out;
  };

  // SQEM-324 — load a persona with its routes, filtered to what THIS caller may open.
  //
  // ⚠️ The route filter is `canAccessTemplate`, never the persona's own access. A persona shared
  // with everyone may attach a template restricted to its author; the colleague gets the persona
  // without that route, and the template stays shut. Filtering on the persona instead would hand out
  // its author's reach along with it — a permission grant by attachment.
  const renderPersona = async (persona: PersonaRow) => {
    const { data: routeRows } = await client
      .from('persona_templates')
      .select('template_id, condition, sort_order, prompts(title, kind, description)')
      .eq('persona_id', persona.id)
      .order('sort_order');

    const routes = ((routeRows as any[] | null) || [])
      .filter(r => r.prompts && canAccessTemplate(r.template_id))
      .map(r => ({
        name:        toSlug(r.prompts.title),
        title:       r.prompts.title,
        kind:        r.prompts.kind,
        condition:   r.condition || '',
        description: r.prompts.description || '',
      }));

    return { text: composePersona(persona, routes), routeCount: routes.length };
  };

  return {
    canAccessTemplate,
    canAccessPersona,
    canAccessFile: (id: string) => accessibleFileIds.has(id),
    resolveContextFiles,
    routeVisibility,
    renderPersona,

    async listTemplates({ kind = null } = {}) {
      let query = client
        .from('prompts')
        .select('id, title, description, kind, variables, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill') // SQEM-110/210 — vestigial guard
        .order('title');
      if (kind && kind !== 'all') query = query.eq('kind', kind);
      const { data: templates } = await query;

      const visible = (templates || [])
        .filter((t: any) => canAccessTemplate(t.id)); // SQEM-142/210 — access-filtered
      // SQEM-232 — stats computed AFTER the access filter, so a template the caller may not see
      // contributes nothing, not even its file count.
      const stats = await contextFileStats(visible);

      return visible.map((t: any) => {
        const s = stats.get(t.id);
        return {
          id:            t.id,
          name:          toSlug(t.title),
          title:         t.title,
          kind:          t.kind,
          description:   t.description || '',
          argumentCount: (t.variables || []).filter((v: any) => v.type !== 'file').length,
          // Omitted entirely when there are no files — a list of zeroes is noise the model has to
          // read past on every entry, and most templates carry nothing.
          ...(s ? { contextFileCount: s.count, contextBytes: s.bytes } : {}),
        };
      });
    },

    async searchTemplates({ query: rawQuery, kind = null }) {
      const needle = (rawQuery || '').toLowerCase();
      if (!needle) throw new LibraryBadRequest('Missing search query');

      let dbQuery = client
        .from('prompts')
        .select('id, title, description, kind, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard
      if (kind) dbQuery = dbQuery.eq('kind', kind);
      const { data: templates } = await dbQuery;

      const matched = (templates || [])
        .filter((t: any) =>
          canAccessTemplate(t.id) && ( // SQEM-142/210 — access-filtered
            t.title.toLowerCase().includes(needle) ||
            (t.description || '').toLowerCase().includes(needle)
          )
        );
      // SQEM-232 — only for the matches, so a search that hits nothing costs no extra query.
      const stats = await contextFileStats(matched);

      return matched.map((t: any) => {
        const s = stats.get(t.id);
        return {
          id:          t.id,
          name:        toSlug(t.title),
          title:       t.title,
          kind:        t.kind,
          description: t.description || '',
          ...(s ? { contextFileCount: s.count, contextBytes: s.bytes } : {}),
        };
      });
    },

    async getTemplate({ id: templateId, name: templateName, includeFiles = 'inline' }) {
      if (!templateId && !templateName) throw new LibraryBadRequest('Provide either id or name');

      // SQEM-481 — fetch ONE row with its content, not every row. This used to select the content
      // of every template in the workspace to pick one out in memory — several hundred bodies per
      // call. A name is matched on the slug, which is computed — since SQEM-500 against the titles
      // the access sets already carry, so it costs no query at all.
      const resolvedId: string | undefined = templateId ?? templateIdBySlug.get(templateName!);
      // SQEM-142 — checked before the content is fetched, so a closed template's body is never read.
      if (!resolvedId || !canAccessTemplate(resolvedId)) throw new LibraryNotFound('Template not found');

      const { data: tpl } = await client
        .from('prompts')
        .select('id, title, description, kind, content, variables, context_file_ids')
        .eq('workspace_id', workspaceId)
        .eq('id', resolvedId)
        .or('published.eq.true,kind.eq.skill') // SQEM-110/210 — vestigial guard
        .maybeSingle();

      if (!tpl) throw new LibraryNotFound('Template not found');

      // SQEM-230 — how context files come back. `inline` stays the module default so every existing
      // MCP caller gets byte-identical output; an unknown value is rejected rather than silently
      // treated as the default, because a typo'd mode would look like it worked while doing the
      // opposite.
      if (includeFiles !== 'inline' && includeFiles !== 'list') {
        throw new LibraryBadRequest(`include_files must be "inline" or "list" (got "${includeFiles}")`);
      }

      // Text context files are inlined; binaries (PDF/images) are referenced by resource URI.
      let content = tpl.content || '';
      const resolved = await resolveContextFiles(tpl.context_file_ids, { mode: includeFiles as 'inline' | 'list' });
      for (const block of renderContextBlocks(resolved, includeFiles)) {
        content += `\n\n${block}`;
      }

      // In `inline` mode the shape is untouched — adding fields here would change every existing
      // caller's payload, which is exactly what the default is meant to prevent.
      //
      // Access note (SQEM-230, decided 2026-08-16): the uris below are read back through
      // `resources/read` (MCP) or `read_context_file` (Chat), which authorise on the workspace file
      // set — NOT on template access. That is deliberate and matches the product: `workspace_files`
      // is a workspace-wide library (SQEM-039, `workspace_files_select` grants every member every
      // file), and one file may be attached to several templates, so "which template decides?" has
      // no answer. Do not "fix" this into template-derived access without also filtering the
      // listings — otherwise a caller could list a file it may not read.
      const contextFiles = resolved.map(f => {
        const base = { name: f.name, uri: f.uri, mimeType: f.mimeType };
        if (includeFiles === 'inline') return base;
        const listed: any = { ...base, byteSize: f.byteSize };
        if (f.preview != null) {
          listed.preview = f.preview;
          listed.previewTruncated = f.previewTruncated ?? false;
        }
        return listed;
      });

      const vars = (tpl.variables || []).filter((v: any) => v.type !== 'file');
      const result: TemplateDetail = {
        id:            tpl.id,
        name:          toSlug(tpl.title),
        title:         tpl.title,
        kind:          tpl.kind,
        description:   tpl.description || '',
        content,
        argumentCount: vars.length,
        variables:     vars.map((v: any) => ({ name: v.name, label: v.label, type: v.type })),
        contextFiles,
      };
      return result;
    },

    async listPersonas() {
      const { data: personaRows } = await client
        .from('personas')
        .select('id, title, description')
        .eq('workspace_id', workspaceId)
        .order('title');

      const visible = ((personaRows as any[] | null) || []).filter(p => canAccessPersona(p.id));

      // The route count is AFTER the template filter, so it reports what this caller would actually
      // get — not what the author sees. A "7 routes" that turns into 4 on load is worse than no
      // number. SQEM-326 — one batched lookup rather than a query per persona.
      const counts = await routeVisibility(visible.map(p => p.id));
      return visible
        .filter(p => !hiddenFromCaller(counts.get(p.id)))
        .map(persona => ({
          id: persona.id,
          name: toSlug(persona.title),
          title: persona.title,
          description: persona.description || '',
          routeCount: counts.get(persona.id)?.visible ?? 0,
        }));
    },

    async getPersona({ id: personaId, name: personaName }) {
      if (!personaId && !personaName) throw new LibraryBadRequest('Provide either id or name');

      const { data: personaRows } = await client
        .from('personas')
        .select('id, title, description, content')
        .eq('workspace_id', workspaceId);

      const persona = personaId
        ? ((personaRows as any[] | null) || []).find(p => p.id === personaId)
        : ((personaRows as any[] | null) || []).find(p => toSlug(p.title) === personaName);

      if (!persona || !canAccessPersona(persona.id)) throw new LibraryNotFound('Persona not found');
      // SQEM-326 — same rule as the listing: a persona whose every route is out of reach is not
      // offered. Answering "not found" rather than explaining is deliberate — the alternative tells
      // a model that something exists which it may not have, and it reaches for it anyway.
      if (hiddenFromCaller((await routeVisibility([persona.id])).get(persona.id))) {
        throw new LibraryNotFound('Persona not found');
      }

      return renderPersona(persona as PersonaRow);
    },

    async readContextFile(ref: string) {
      const fileId = String(ref || '').replace(/^sqemes:\/\/files\//, '');
      const uri = `sqemes://files/${fileId}`;

      // SQEM-291 — checked before the row is fetched, and answered with "not found" rather than
      // "forbidden". A distinct denial would confirm that the id exists, which is the thing the
      // caller is not entitled to know here.
      if (!fileId || !accessibleFileIds.has(fileId)) throw new LibraryNotFound(`Resource not found: ${ref}`);

      const { data: file } = await client
        .from('workspace_files')
        .select('id, name, mime_type, storage_path, workspace_file_texts(content)')
        .eq('workspace_id', workspaceId)
        .eq('id', fileId)
        .single();

      if (!file || !isPathInWorkspace(file.storage_path, workspaceId)) throw new LibraryNotFound(`Resource not found: ${ref}`);

      // SQEM-500 — a text file read before is answered from the database, without storage.
      const stored = isTextContentMime(file.mime_type) ? storedTextOf(file) : null;
      if (stored != null) return { uri, name: file.name, mimeType: file.mime_type, text: stored, base64: null };

      const { data: blob, error: storageErr } = await client.storage
        .from('workspace-files')
        .download(file.storage_path);

      if (storageErr || !blob) throw new LibraryNotFound('File content not available');

      if (isTextContentMime(file.mime_type)) {
        const text = await blob.text();
        try {
          await client.from('workspace_file_texts')
            .upsert([{ file_id: file.id, workspace_id: workspaceId, content: text }], { onConflict: 'file_id', ignoreDuplicates: true });
        } catch (e) {
          console.error('[library] text write-back failed:', (e as Error)?.message);
        }
        return { uri, name: file.name, mimeType: file.mime_type, text, base64: null };
      }
      return {
        uri, name: file.name, mimeType: file.mime_type,
        text: null, base64: toBase64(await blob.arrayBuffer()),
      };
    },
  };
}
