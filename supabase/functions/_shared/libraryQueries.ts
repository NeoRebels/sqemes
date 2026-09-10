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

/** One context file, resolved from storage. `text` is null for binaries. */
export interface ResolvedFile {
  id: string;
  name: string;
  mimeType: string;
  uri: string;
  byteSize: number;
  text: string | null;
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
  system_instruction?: string;
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
  resolveContextFiles(fileIds: string[] | null | undefined): Promise<ResolvedFile[]>;
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
 * ⚠️ The three access sets cost three round trips and are built eagerly, because every one of them
 * is needed by at least one handler and a lazy build would have made the first call of a session
 * pay a different price than the rest — which is exactly the kind of variance that gets mistaken for
 * a slow query later. `mcp-server` already built all three per request before this module existed.
 */
export async function createLibraryReader(
  { client, workspaceId, userId }: LibraryReaderOptions,
): Promise<LibraryReader> {
  // SQEM-142/210 — per-user template access, evaluated by the database so the rule lives once.
  const { data: accRows } = await client.rpc('mcp_accessible_template_ids', {
    p_workspace_id: workspaceId, p_user_id: userId,
  });
  const accessibleTemplates = new Set(((accRows as { id: string }[] | null) || []).map(r => r.id));
  const canAccessTemplate = (templateId: string): boolean => accessibleTemplates.has(templateId);

  // SQEM-324 — the same question for personas, answered the same way and for the same reasons.
  const { data: pAccRows } = await client.rpc('mcp_accessible_persona_ids', {
    p_workspace_id: workspaceId, p_user_id: userId,
  });
  const accessiblePersonas = new Set(((pAccRows as { id: string }[] | null) || []).map(r => r.id));
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
  // Built as a set once, not a check per file: a listing would otherwise make one round trip per
  // row. The uploader clause mirrors `can_access_file()`.
  const accessibleFileIds: Set<string> = await (async () => {
    const { data: rows } = await client
      .from('prompts')
      .select('id, context_file_ids')
      .eq('workspace_id', workspaceId);
    type Row = { id: string; context_file_ids: string[] | null };
    const all = (rows as Row[] | null) || [];
    const ids = new Set<string>();
    for (const r of all) {
      if (!canAccessTemplate(r.id)) continue;
      for (const fid of r.context_file_ids || []) ids.add(fid);
    }
    const { data: own } = await client
      .from('workspace_files')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('created_by', userId);
    for (const f of (own as { id: string }[] | null) || []) ids.add(f.id);
    return ids;
  })();

  // Resolves context files from storage (source of truth — no longer extracted_text).
  // Text files carry their content; binaries carry only a resource URI to fetch.
  const resolveContextFiles = async (fileIds: string[] | null | undefined): Promise<ResolvedFile[]> => {
    if (!fileIds?.length) return [];
    const { data: files } = await client
      .from('workspace_files')
      .select('id, name, mime_type, size_bytes, storage_path')
      .eq('workspace_id', workspaceId)
      .in('id', fileIds);

    const resolved: ResolvedFile[] = [];
    for (const f of (files || [])) {
      let text: string | null = null;
      if (isTextContentMime(f.mime_type)) {
        const { data: blob } = await client.storage.from('workspace-files').download(f.storage_path);
        if (blob) text = await blob.text();
      }
      resolved.push({
        id: f.id,
        name: f.name,
        mimeType: f.mime_type,
        uri: `sqemes://files/${f.id}`,
        byteSize: f.size_bytes ?? 0,
        text,
      });
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

      const { data: templates } = await client
        .from('prompts')
        .select('id, title, description, kind, content, system_instruction, variables, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard

      const tpl = templateId
        ? (templates || []).find((t: any) => t.id === templateId)
        : (templates || []).find((t: any) => toSlug(t.title) === templateName);

      if (!tpl || !canAccessTemplate(tpl.id)) throw new LibraryNotFound('Template not found'); // SQEM-142

      // SQEM-230 — how context files come back. `inline` stays the module default so every existing
      // MCP caller gets byte-identical output; an unknown value is rejected rather than silently
      // treated as the default, because a typo'd mode would look like it worked while doing the
      // opposite.
      if (includeFiles !== 'inline' && includeFiles !== 'list') {
        throw new LibraryBadRequest(`include_files must be "inline" or "list" (got "${includeFiles}")`);
      }

      // Text context files are inlined; binaries (PDF/images) are referenced by resource URI.
      let content = tpl.content || '';
      const resolved = await resolveContextFiles(tpl.context_file_ids);
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
        if (f.text != null) {
          const { preview, truncated } = buildPreview(f.text, f.mimeType);
          listed.preview = preview;
          listed.previewTruncated = truncated;
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
      if (tpl.system_instruction) result.system_instruction = tpl.system_instruction;
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
        .select('id, name, mime_type, storage_path')
        .eq('workspace_id', workspaceId)
        .eq('id', fileId)
        .single();

      if (!file) throw new LibraryNotFound(`Resource not found: ${ref}`);

      const { data: blob, error: storageErr } = await client.storage
        .from('workspace-files')
        .download(file.storage_path);

      if (storageErr || !blob) throw new LibraryNotFound('File content not available');

      if (isTextContentMime(file.mime_type)) {
        return { uri, name: file.name, mimeType: file.mime_type, text: await blob.text(), base64: null };
      }
      return {
        uri, name: file.name, mimeType: file.mime_type,
        text: null, base64: toBase64(await blob.arrayBuffer()),
      };
    },
  };
}
