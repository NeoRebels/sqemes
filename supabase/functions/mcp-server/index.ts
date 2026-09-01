import JSZip from 'npm:jszip@3.10.1';
import { createAdminClient } from '../_shared/supabase-admin.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';
import { safeStorageFileName } from '../_shared/storageKey.ts';
import { readSkillMd, toSlug as skillSlug, withoutOwnFrontmatter } from '../_shared/skillMd.ts';
import {
  findSkillRoot,
  isArchiveJunk,
  downloadArchive,
  resolveArchiveUrl,
  SKILL_ENTRY,
} from '../_shared/skillArchive.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MCP_VERSION = '2025-03-26';

// ---- JSON-RPC helpers ----

function rpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function rpcError(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 200, // MCP errors are always HTTP 200
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// 401 with the OAuth resource-metadata challenge. Returned for missing, malformed,
// invalid, or expired credentials so spec-compliant MCP clients (re)authorize.
function authChallenge(): Response {
  // SQEM-088 — advertise the custom domain (PUBLIC_API_URL) when set, so the resource
  // metadata pointer matches the domain the client connected to; else the project URL.
  const publicBase = (Deno.env.get('PUBLIC_API_URL') ?? Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
  const oauthBase = `${publicBase}/functions/v1/mcp-oauth`;
  return new Response(null, {
    status: 401,
    headers: {
      ...CORS,
      'WWW-Authenticate': `Bearer realm="sqemes", resource_metadata="${oauthBase}/.well-known/oauth-protected-resource"`,
    },
  });
}

// ---- MCP connection scopes (SQEM-064) ----
// Each tool/read-method requires a capability; a connection grants a subset.
type Capability = 'read' | 'create' | 'update' | 'delete';
const FULL_SCOPES: Capability[] = ['read', 'create', 'update', 'delete'];
const TOOL_CAPABILITY: Record<string, Capability> = {
  list_templates:    'read',
  search_templates:  'read',
  get_template:      'read',
  list_files:        'read',
  create_template:   'create',
  import_skill_from_url: 'create',
  upload_file:       'create',
  create_upload_url: 'create',
  finalize_upload:   'create',
  update_template:   'update',
  delete_template:   'delete',
  delete_file:       'delete',
};
const READ_METHODS = new Set(['prompts/list', 'prompts/get', 'resources/list', 'resources/read']);

// ---- Text file MIME types allowed for upload_file ----

const TEXT_MIME: Record<string, string> = {
  txt:  'text/plain',
  md:   'text/markdown',
  mdx:  'text/markdown',
  rst:  'text/x-rst',
  json: 'application/json',
  yaml: 'text/yaml',
  yml:  'text/yaml',
  toml: 'application/toml',
  csv:  'text/csv',
  xml:  'text/xml',
  html: 'text/html',
  css:  'text/css',
  scss: 'text/x-scss',
  sass: 'text/x-sass',
  sql:  'application/sql',
  js:   'text/javascript',
  mjs:  'text/javascript',
  cjs:  'text/javascript',
  ts:   'text/typescript',
  jsx:  'text/jsx',
  tsx:  'text/tsx',
  py:   'text/x-python',
  rb:   'text/x-ruby',
  go:   'text/x-go',
  rs:   'text/x-rust',
  java: 'text/x-java',
  php:  'text/x-php',
  swift:'text/x-swift',
  kt:   'text/x-kotlin',
  c:    'text/x-c',
  cpp:  'text/x-c++',
  cs:   'text/x-csharp',
  sh:   'text/x-sh',
  bash: 'text/x-sh',
};

// ---- Binary types accepted via create_upload_url (must match the storage bucket allowlist) ----

const BINARY_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

// ---- Skill folders fetched by URL (SQEM-248) ----
//
// A skill folder may hold pictures beside its text — a diagram skill ships example renders. Mapped
// by extension because a zip entry carries no MIME type; the values must stay inside BINARY_MIME,
// which is the storage bucket's own allowlist.
// What text goes into the bucket as. The bucket's allowlist
// (`20260617000000_workspace_files.sql`) holds three text types; `TEXT_MIME` holds thirty-odd, and
// the difference is not a bug in either — the row carries the truthful mime, storage only needs to
// accept the bytes. `upload_file` has always done this; naming it makes the rule checkable
// (`tests/unit/skillImport.test.ts`) instead of a habit two call sites happen to share.
const STORAGE_TEXT_MIME = 'text/plain';

const BINARY_EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Caps for the fetched archive. The download cap is the cheap one — it refuses before anything is
// unpacked; the uncompressed cap is the zip-bomb guard, and the file cap keeps one call from filling
// a workspace. `diagram-design`, the skill this was built against, is 152 files and 2 MB.
const SKILL_MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const SKILL_MAX_FILES = 500;
// How many storage uploads run at once. Sequential is too slow for 150 files inside one request;
// unbounded parallelism is how you get rate-limited by your own storage API.
const SKILL_UPLOAD_CONCURRENCY = 8;

/**
 * SQEM-240 — does this workspace start new templates restricted?
 *
 * The owner (`created_by`) and this default were both missing on the MCP write path, and it was the
 * only write path in the product that skipped them: the marketplace copy and the browser editor have
 * always set `created_by`, and the browser applies `default_template_access` via
 * `seedFromWorkspaceDefault`. There is no trigger on `prompts` doing either.
 *
 * ⚠️ `created_by = NULL` is not cosmetic. `can_access_template` compares `created_by` to the caller,
 * and `NULL = <uid>` is NULL — never true. Choosing "Only me" on such a template then writes the
 * principal-less row, which suspends the admin/editor branch (SQEM-212), and the template becomes
 * invisible to EVERYONE including its owner, recoverable only by SQL. Measured on production
 * 2026-08-17: 47 of 82 templates had no owner, 24 of 29 skills.
 *
 * Without an authorizing user we set neither. Decided with the product owner (2026-08-17): **a
 * workspace API key creates "everyone" templates only, and reads only "everyone".** It cannot express
 * "only me" because there is no "me" — and seeding a restriction here would manufacture exactly the
 * unreachable row described above. The tool descriptions say so.
 *
 * SQEM-248 — shared by `create_template` and `import_skill_from_url` rather than copied. A second
 * copy of this rule is how the first one came to be missing.
 */
async function workspaceRestrictsNewTemplates(
  adminClient: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  mcpUserId: string | null,
): Promise<boolean> {
  if (!mcpUserId) return false;
  const { data: ws } = await adminClient
    .from('workspaces')
    .select('default_template_access')
    .eq('id', workspaceId)
    .single();
  const dflt = (ws as { default_template_access?: string[] | null } | null)?.default_template_access;
  // SQEM-211 — this column is a two-state marker, not a grantee list. Non-empty means "new templates
  // start restricted"; reading its roles as who-may-see-it is wrong.
  return Array.isArray(dflt) && dflt.length > 0;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order in the result. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  });
  await Promise.all(workers);
  return out;
}

// ---- Helpers ----

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function substituteVariables(content: string, inputs: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, name) => inputs[name] ?? '');
}

// Mimes whose stored bytes are textual content (inlined directly). Everything else
// (PDF, images) is binary — referenced by resource URI for the client to fetch.
function isTextContentMime(mime: string): boolean {
  return mime.startsWith('text/')
    || mime === 'application/json'
    || mime === 'application/toml'
    || mime === 'application/sql';
}

// Chunk-safe base64 — spreading a large Uint8Array into String.fromCharCode overflows the stack.
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Resolves context files from storage (source of truth — no longer extracted_text).
// Text files carry their content; binaries carry only a resource URI to fetch.
async function resolveContextFiles(
  client: any,
  workspaceId: string,
  fileIds: string[] | null | undefined,
): Promise<Array<{ id: string; name: string; mimeType: string; uri: string; byteSize: number; text: string | null }>> {
  if (!fileIds?.length) return [];
  const { data: files } = await client
    .from('workspace_files')
    .select('id, name, mime_type, size_bytes, storage_path')
    .eq('workspace_id', workspaceId)
    .in('id', fileIds);

  const resolved = [];
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
}

// ---- SQEM-232 — context-file stats for list_templates / search_templates ----

// SQEM-230 gave get_template an `include_files: "list"` mode, but a caller had no way to know it was
// worth using: neither list_templates nor search_templates said anything about attached files. The
// decision had to be made before the information existed. These two numbers close that gap.
//
// Measured on production 2026-08-16 before choosing the query shape: 44 files in the workspace, 42 of
// them referenced by some template, 78 templates of which 18 carry files. Fetching every file's
// id+size for the workspace is therefore ~44 rows (~2 KB) and simpler than assembling an id union
// that would select almost the same rows anyway. **If a workspace ever holds thousands of files with
// only a handful attached, switch to `.in()` over the union of context_file_ids** — the tradeoff
// flips there, and this comment is the reason it was not written that way from the start.
async function contextFileStats(
  client: any,
  workspaceId: string,
  templates: Array<{ id: string; context_file_ids: string[] | null }>,
): Promise<Map<string, { count: number; bytes: number }>> {
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
    // Count only ids that actually resolve, so count and bytes describe the same set. A dangling id
    // (file deleted, reference left behind) would otherwise inflate the count while contributing
    // nothing to the size, and the caller would size its decision on a file that cannot be read.
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
function buildPreview(text: string, mimeType: string): { preview: string; truncated: boolean } {
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

// Renders resolved context files as prompt text: text inline, binaries as a URI reference.
//
// SQEM-230 — `mode: 'list'` renders text files the same way binaries have always been rendered, by
// reference. The body then names what context exists without carrying it, which is the whole point:
// the caller decides per file whether to spend the tokens.
function renderContextBlocks(
  resolved: Array<{ name: string; mimeType: string; uri: string; text: string | null }>,
  mode: 'inline' | 'list' = 'inline',
): string[] {
  return resolved.map(f =>
    f.text != null && mode === 'inline'
      ? `[Context: ${f.name}]\n${f.text}`
      : `[Context file: ${f.name} (${f.mimeType}) — read via ${f.uri}]`,
  );
}

// Extracts {{placeholder}} names from content and builds a variables array.
// Only used for kind=prompt — skills and assistants do not support variables.
function extractVariables(content: string): any[] {
  const seen = new Set<string>();
  const regex = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) seen.add(m[1]);
  return Array.from(seen).map(name => ({
    id: crypto.randomUUID(),
    name,
    label: name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    type: 'text',
  }));
}

// Normalises the variables param accepted by create/update tools.
// Accepts [{name, label?, type?}] — label and type are optional.
function normaliseVariables(raw: any[]): any[] {
  return raw.map((v: any) => ({
    id:    v.id    ?? crypto.randomUUID(),
    name:  v.name,
    label: v.label ?? v.name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    type:  v.type  ?? 'text',
  }));
}

function buildArguments(variables: any[]): any[] {
  return variables
    .filter((v: any) => v.type !== 'file')
    .map((v: any) => ({
      name: v.name,
      description: v.label || v.name,
      required: !v.defaultValue,
    }));
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  // 1. Authenticate via sqemes API key
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) {
    return authChallenge();
  }
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!rawKey.startsWith('sqm_live_')) {
    return authChallenge();
  }

  const adminClient = createAdminClient();
  const keyHash = await hashKey(rawKey);

  const { data: keyRow, error: keyErr } = await adminClient
    .from('sqemes_api_keys')
    .select('id, workspace_id, name, scopes, expires_at, is_oauth, user_id')
    .eq('key_hash', keyHash)
    .single();

  if (keyErr || !keyRow) {
    return authChallenge();
  }

  // Expired connection — challenge so OAuth clients re-authorize (SQEM-064).
  if (keyRow.expires_at && new Date(keyRow.expires_at).getTime() <= Date.now()) {
    return authChallenge();
  }

  const { workspace_id: workspaceId, id: keyId } = keyRow;
  // Granted capabilities. SQEM-111 — an OAuth connection always carries explicit scopes
  // (minted with ['read']), so an empty/null set on one is anomalous (tampered) → grant nothing.
  // Only legacy manual keys (pre-SQEM-064, non-OAuth) keep the full-access default.
  const scopes: string[] = Array.isArray(keyRow.scopes) && keyRow.scopes.length > 0
    ? keyRow.scopes
    : (keyRow.is_oauth ? [] : FULL_SCOPES);
  await adminClient.from('sqemes_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyId);

  // 2. Parse JSON-RPC request
  let rpc: { jsonrpc: string; id?: unknown; method: string; params?: any };
  try {
    rpc = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  const { id, method, params } = rpc;

  // SQEM-083 — server-side paywall: a lapsed workspace may handshake (initialize/ping)
  // but can't use any data method until it has an active subscription.
  if (method !== 'initialize' && method !== 'ping'
      && !(await isWorkspaceSubscriptionActive(adminClient, workspaceId))) {
    return rpcError(id, -32003, 'This Sqemes workspace has no active subscription. Resubscribe at app.sqemes.com to use MCP.');
  }

  // Read-capability gate for the MCP read primitives (SQEM-064).
  if (READ_METHODS.has(method) && !scopes.includes('read')) {
    return rpcError(id, -32002, `Insufficient scope: '${method}' requires the 'read' permission.`);
  }

  // SQEM-142 — per-user template access. OAuth connections carry the authorizing user; restrict
  // templates to what that user may access.
  const mcpUserId: string | null = (keyRow as { user_id?: string | null }).user_id ?? null;
  let canAccessTemplate: (templateId: string) => boolean;

  if (mcpUserId) {
    const { data: accRows } = await adminClient.rpc('mcp_accessible_template_ids', {
      p_workspace_id: workspaceId, p_user_id: mcpUserId,
    });
    const accessible = new Set(((accRows as { id: string }[] | null) || []).map(r => r.id));
    canAccessTemplate = (templateId: string) => accessible.has(templateId);
  } else {
    // SQEM-210 — an API-key connection has no user, so no access rule can be evaluated *for*
    // anyone. It therefore gets only what is open to everyone: templates with no access rules.
    //
    // This closes a real hole rather than a theoretical one. Until now these connections skipped
    // access filtering entirely and saw every template in the workspace; the only thing holding
    // restricted ones back was `published = false`, which SQEM-210 retires. Without this, "Only me"
    // would have become "anyone holding the workspace API key".
    //
    // Deliberately over-restrictive: a template restricted *to the key's owner* is invisible here
    // too, because there is no owner to compare against. Bind the key to a user (OAuth) to get the
    // per-user set. Restricting too much is the recoverable direction; leaking is not.
    const { data: ruleRows } = await adminClient
      .from('template_access')
      .select('template_id')
      .eq('workspace_id', workspaceId);
    const restricted = new Set(((ruleRows as { template_id: string }[] | null) || []).map(r => r.template_id));
    canAccessTemplate = (templateId: string) => !restricted.has(templateId);
  }

  // SQEM-291 — the same question for context files, and it is not answered by the line above.
  //
  // `resolveContextFiles` is safe already: it only ever runs for a template the caller reached, so
  // the file rides along with something they may see. **`resources/list` and `resources/read` are
  // not** — they addressed the whole workspace by id, so a model could enumerate the names of every
  // file in it and read any of them, including those attached to templates the caller cannot open.
  //
  // Enumeration is the sharper half: nobody asked for that list, and a file name alone can be the
  // disclosure ("Q3-layoffs.xlsx").
  //
  // Built as a set once, not a check per file: `resources/list` would otherwise make one round trip
  // per row. The uploader clause mirrors `can_access_file()` — an API-key connection has no user, so
  // `mcpUserId` is null and nothing is claimed as uploaded by anybody.
  const accessibleFileIds: Set<string> = await (async () => {
    const { data: rows } = await adminClient
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
    if (mcpUserId) {
      const { data: own } = await adminClient
        .from('workspace_files')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('created_by', mcpUserId);
      for (const f of (own as { id: string }[] | null) || []) ids.add(f.id);
    }
    return ids;
  })();

  // 3. Route methods

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_VERSION,
      capabilities: { prompts: {}, resources: {}, tools: {} },
      // SQEM-132 — session-level guidance. Claude clients surface a server's `instructions`
      // in the system context at session start, before any per-request tool matching. This
      // is the strongest lever for getting a connected client to proactively consider the
      // user's templates on relevant requests, instead of only when they name Sqemes.
      instructions:
        "Sqemes is this workspace's template library — reusable prompts, assistants, and " +
        "skills the user has curated for their recurring tasks.\n\n" +
        "Before writing, drafting, generating, reviewing, or rewriting any substantial " +
        "content from scratch — an email, a spec, a plan, a code review, a message, a " +
        "prompt — first call search_templates with a keyword from the request to check " +
        "whether a matching template already exists. If one does, load it with get_template " +
        "and follow it. If nothing matches, proceed normally.\n\n" +
        "Templates encode the user's preferred structure and wording, so reusing one is " +
        "usually better than improvising.",
      // SQEM-089 — brand the connector. `icons` (MCP SEP-973) is additive metadata a
      // client MAY render in its connector list; PNG over HTTPS is the safest, most
      // widely-supported form, served credential-free from our own domain. `sizes` is
      // omitted deliberately — its format varies across spec revisions (string vs array)
      // and `'any'` is for scalable SVG, so a strict client could reject a raster icon
      // declared with it; omitting = "usable at any size".
      serverInfo: {
        name: 'sqemes',
        title: 'Sqemes',
        version: '2.0.0',
        websiteUrl: 'https://app.sqemes.com',
        icons: [
          { src: 'https://app.sqemes.com/logo-favicon-V2.png', mimeType: 'image/png' },
        ],
      },
    });
  }

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ---- prompts/list ----

  if (method === 'prompts/list') {
    const { data: templates } = await adminClient
      .from('prompts')
      .select('id, title, description, variables, kind')
      .eq('workspace_id', workspaceId)
      // SQEM-110 kept a draft out of MCP. SQEM-210 retired that axis — `published` is true for
      // every workspace template now, so this is a no-op guard against a stray false row from an
      // older client, not the boundary. Visibility is the access filter below.
      .or('published.eq.true,kind.eq.skill')
      .order('title');

    const prompts = (templates || [])
      .filter((t: any) => canAccessTemplate(t.id)) // SQEM-142/210 — access-filtered (per user on OAuth, open-only on API keys)
      .map((t: any) => ({
        name: toSlug(t.title),
        description: `[${t.kind}] ${t.description || t.title}`,
        arguments: buildArguments(t.variables || []),
      }));

    return rpcResult(id, { prompts });
  }

  // ---- prompts/get ----

  if (method === 'prompts/get') {
    const name: string = params?.name;
    const args: Record<string, string> = params?.arguments || {};

    if (!name) return rpcError(id, -32602, 'Missing prompt name');

    const { data: templates } = await adminClient
      .from('prompts')
      .select('id, title, description, content, system_instruction, variables, context_file_ids, kind')
      .eq('workspace_id', workspaceId)
      .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard, see above

    const template = (templates || []).find((t: any) => toSlug(t.title) === name);
    if (!template || !canAccessTemplate(template.id)) return rpcError(id, -32602, `Prompt not found: ${name}`); // SQEM-142

    const resolvedInputs: Record<string, string> = {};
    for (const v of (template.variables || [])) {
      if (v.type === 'file') continue;
      resolvedInputs[v.name] = args[v.name] ?? v.defaultValue ?? '';
    }

    const resolvedContext = await resolveContextFiles(adminClient, workspaceId, template.context_file_ids);
    const contextParts: string[] = renderContextBlocks(resolvedContext);

    const renderedContent = substituteVariables(template.content || '', resolvedInputs);

    const parts: string[] = [];
    if (contextParts.length > 0) parts.push(contextParts.join('\n\n'));
    if (renderedContent) parts.push(renderedContent);

    const text = parts.join('\n\n');
    const messages: any[] = [];

    if (template.kind === 'assistant' && template.system_instruction) {
      messages.push({
        role: 'user',
        content: { type: 'text', text: substituteVariables(template.system_instruction, resolvedInputs) },
      });
    } else {
      messages.push({
        role: 'user',
        content: { type: 'text', text: text },
      });
    }

    return rpcResult(id, {
      description: template.description || template.title,
      messages,
    });
  }

  // ---- resources/list ----

  if (method === 'resources/list') {
    const { data: files } = await adminClient
      .from('workspace_files')
      .select('id, name, mime_type')
      .eq('workspace_id', workspaceId)
      .order('name');

    // SQEM-291 — filtered, not just fetched. Listing a name is a disclosure of its own.
    const resources = (files || []).filter((f: any) => accessibleFileIds.has(f.id)).map((f: any) => ({
      uri: `sqemes://files/${f.id}`,
      name: f.name,
      mimeType: f.mime_type,
    }));

    return rpcResult(id, { resources });
  }

  // ---- resources/read ----

  if (method === 'resources/read') {
    const uri: string = params?.uri;
    if (!uri) return rpcError(id, -32602, 'Missing URI');

    const fileId = uri.replace(/^sqemes:\/\/files\//, '');

    // SQEM-291 — checked before the row is fetched, and answered with "not found" rather than
    // "forbidden". A distinct denial would confirm that the id exists, which is the thing the caller
    // is not entitled to know here.
    if (!accessibleFileIds.has(fileId)) return rpcError(id, -32602, `Resource not found: ${uri}`);

    const { data: file } = await adminClient
      .from('workspace_files')
      .select('id, name, mime_type, storage_path')
      .eq('workspace_id', workspaceId)
      .eq('id', fileId)
      .single();

    if (!file) return rpcError(id, -32602, `Resource not found: ${uri}`);

    const { data: blob, error: storageErr } = await adminClient.storage
      .from('workspace-files')
      .download(file.storage_path);

    if (storageErr || !blob) {
      return rpcError(id, -32603, 'File content not available');
    }

    // Text content is returned inline; binaries (PDF/images) as base64.
    if (isTextContentMime(file.mime_type)) {
      return rpcResult(id, {
        contents: [{ uri, mimeType: file.mime_type, text: await blob.text() }],
      });
    }

    const base64 = toBase64(await blob.arrayBuffer());
    return rpcResult(id, {
      contents: [{ uri, mimeType: file.mime_type, blob: base64 }],
    });
  }

  // ---- tools/list ----

  if (method === 'tools/list') {
    const tools = [
      {
        name: 'list_templates',
        description: 'Browse every published template in the workspace (prompts, assistants, skills) with id, name, kind and description. Use this to see what reusable templates exist before composing something from scratch, or to find a template\'s id/name to pass to get_template. For a targeted lookup by keyword use search_templates instead. Optionally filter by kind.\n\nTemplates with attached context files also report "contextFileCount" and "contextBytes" (absent when there are none). Use them to decide HOW to load the template: when a template has several files or a large total, call get_template with include_files: "list" — you then get each file\'s name, size and a preview instead of its full text, and read only the ones you need via resources/read. For one small file, the default is fine.',
        inputSchema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['prompt', 'skill', 'assistant', 'all'],
              description: 'Filter by template kind. Defaults to all.',
            },
          },
        },
      },
      {
        name: 'search_templates',
        description: 'Find a workspace template by keyword (matches title and description). Call this first whenever the user asks you to write, draft, generate, review, or rewrite something, to check for a matching prompt, assistant, or skill before composing from scratch. Returns matching templates with their id and name — pass one to get_template to load its full content. Optionally filter by kind.\n\nMatches with attached context files also report "contextFileCount" and "contextBytes" (absent when there are none). Use them to decide HOW to load the template: when a template has several files or a large total, call get_template with include_files: "list" — you then get each file\'s name, size and a preview instead of its full text, and read only the ones you need via resources/read. For one small file, the default is fine.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keyword to search for' },
            kind: {
              type: 'string',
              enum: ['prompt', 'skill', 'assistant'],
              description: 'Optional kind filter',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_template',
        description: 'Load a template\'s full content, variables, and metadata so you can actually use it — e.g. a template found via search_templates or list_templates — by id or name slug. Works for any kind (prompt, assistant, or skill). Binary files (PDF, images) are always listed in "contextFiles" with a resource "uri" — fetch their bytes with resources/read. Text context files are inlined by default, or listed the same way if you pass include_files: "list". Use this to inspect a template before updating it, or to consume a skill\'s full knowledge.',
        inputSchema: {
          type: 'object',
          properties: {
            id:   { type: 'string', description: 'UUID of the template (from list_templates or search_templates)' },
            name: { type: 'string', description: 'Slug name of the template (from list_templates or search_templates)' },
            include_files: {
              type: 'string',
              enum: ['inline', 'list'],
              description: 'How to return TEXT context files. "inline" (default) puts their full content into the template content — right for small files and when you need everything anyway. "list" returns them like binaries instead: an entry in "contextFiles" with name, uri, mimeType, byteSize and a preview (markdown gets its heading outline, other text the opening characters), and no file content in the body. Choose "list" when a template carries large text context, or when several files are attached and only one is likely relevant to the task — then read just that one with resources/read on its uri.',
            },
          },
        },
      },
      {
        name: 'list_files',
        description: 'List all workspace files with their IDs. Use file IDs with create_template or update_template to attach context files to a template.\n\nA name may be a relative path (references/type-bar.md) — that file sits in a folder, and the prefix is part of its name, not decoration.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create_template',
        description: 'Create a new template (prompt, assistant, or skill) in the workspace.\n\nVariables (kind=prompt only): pass a "variables" array of {name, label?, type?} objects. Alternatively, write {{variable_name}} placeholders in content and they are auto-extracted. "type" can be "text" (default) or "textarea" for longer inputs.\nExample: [{"name":"draft","label":"Email Draft","type":"textarea"},{"name":"tone","type":"text"}]\n\nContext files: pass "file_ids" (array of UUIDs from list_files) to attach workspace files as context.\n\nAgent Skills (kind=skill): a skill is a FOLDER, and Sqemes holds it whole. Put the SKILL.md body in "content", its frontmatter title/description in "title"/"description", and upload EVERY other file in the folder via upload_file under its relative path (references/…, scripts/…, assets/…), then attach them all through file_ids. Uploading only the SKILL.md leaves a skill that describes files nobody has.\n\nWho can see it: the new template follows the workspace default — open to everyone, or restricted to you if the workspace starts new templates restricted. Change it per template in the Sqemes app.\nOn a workspace API key (no authorizing user) the template is ALWAYS created open to everyone and has no owner, because there is no "you" to restrict it to. Connect over OAuth if new templates must start restricted.',
        inputSchema: {
          type: 'object',
          properties: {
            kind:               { type: 'string', enum: ['prompt', 'assistant', 'skill'], description: 'Template kind' },
            title:              { type: 'string', description: 'Human-readable display name' },
            content:            { type: 'string', description: 'Template body. For kind=prompt, write {{variable_name}} placeholders for user inputs.' },
            description:        { type: 'string', description: 'Short description. Required for kind=skill — AI agents use this for discovery.' },
            system_instruction: { type: 'string', description: 'System instruction (kind=assistant only).' },
            variables: {
              type: 'array',
              description: 'Explicit variable definitions (kind=prompt only). Each item: {name: string, label?: string, type?: "text"|"textarea"}. If omitted, variables are auto-extracted from {{placeholders}} in content.',
              items: { type: 'object' },
            },
            file_ids: {
              type: 'array',
              description: 'UUIDs of workspace files to attach as context (from list_files). Works for all kinds.',
              items: { type: 'string' },
            },
          },
          required: ['kind', 'title', 'content'],
        },
      },
      {
        name: 'update_template',
        description: 'Partially update an existing template by id. Only provided fields are changed. Get the id from list_templates or search_templates first.\n\nVariables (kind=prompt only): pass "variables" array to replace all variables, or omit to leave them unchanged. If content is updated without a "variables" array, variables are re-extracted from {{placeholders}} in the new content.\n\nContext files: pass "file_ids" to replace the attached file list.',
        inputSchema: {
          type: 'object',
          properties: {
            id:                 { type: 'string', description: 'UUID of the template to update' },
            title:              { type: 'string', description: 'New title' },
            content:            { type: 'string', description: 'New content' },
            description:        { type: 'string', description: 'New description' },
            system_instruction: { type: 'string', description: 'New system instruction' },
            variables: {
              type: 'array',
              description: 'Replace all variables (kind=prompt only). Each item: {name: string, label?: string, type?: "text"|"textarea"}.',
              items: { type: 'object' },
            },
            file_ids: {
              type: 'array',
              description: 'Replace the attached context file list (array of file UUIDs from list_files).',
              items: { type: 'string' },
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'delete_template',
        description: 'Permanently delete a template by id. This cannot be undone. Get the id from list_templates or search_templates first.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'UUID of the template to delete' },
          },
          required: ['id'],
        },
      },
      {
        name: 'import_skill_from_url',
        description: 'Import a whole Anthropic Agent Skill from a public GitHub URL in ONE call. The server downloads the archive, unpacks it, stores every file under its relative path and creates the skill template — the file contents never pass through you.\n\nUSE THIS for any skill that lives in a repository. Uploading a real skill file-by-file via upload_file does not work: a skill folder is routinely megabytes, so you run out of room and it arrives half-complete without anything saying so.\n\nAccepted: https://github.com/owner/repo · https://github.com/owner/repo/tree/<ref>/<folder> · any .zip on a GitHub host. If the archive holds several skills, the call names them and you pass "path" to pick one.\n\nReturns what actually landed: file count, total bytes, and every file that was skipped with the reason. Nothing else in Sqemes reports a partial import, so read it.',
        inputSchema: {
          type: 'object',
          properties: {
            url:  { type: 'string', description: 'Public GitHub URL of the repository, the folder, or a .zip archive.' },
            path: { type: 'string', description: 'Folder inside the archive holding SKILL.md — only needed when the archive holds more than one skill (e.g. skills/diagram-design).' },
          },
          required: ['url'],
        },
      },
      {
        name: 'upload_file',
        description: 'Upload a text file into the workspace so it can be attached to templates via file_ids.\n\nSupported types: .txt .md .mdx .rst .json .yaml .yml .toml .csv .xml .html .css .scss .sass .sql .js .ts .jsx .tsx .mjs .py .rb .go .rs .java .php .swift .kt .c .cpp .cs .sh .bash\n\nFOLDERS: "name" may be a RELATIVE PATH and it is stored exactly as given — that is how a file keeps its place in a folder. Uploading an Agent Skill or any other folder, send each file under its path relative to the folder root (references/type-bar.md, scripts/extract.py), never the bare filename. Sqemes groups files by that prefix into a folder tree, and a skill whose SKILL.md says "see references/x.md" only works when x.md is actually called references/x.md.\n\nFor PDFs and images use create_upload_url + finalize_upload (binary, uploaded out of band). Office documents (.docx/.xlsx/.pptx) are not supported — convert to PDF.\n\nThe returned id can be used directly in file_ids on create_template or update_template without a follow-up list_files call.',
        inputSchema: {
          type: 'object',
          properties: {
            name:    { type: 'string', description: 'Filename with extension, or a relative path when the file belongs to a folder — e.g. schema.json, references/type-bar.md, scripts/extract.py. Paths are preserved verbatim; strip nothing.' },
            content: { type: 'string', description: 'Full file content as plain text' },
          },
          required: ['name', 'content'],
        },
      },
      {
        name: 'create_upload_url',
        description: 'Begin uploading a binary file (PDF or image) that is too large to pass inline. Returns a short-lived signed URL; PUT the raw bytes to it (out of band, with Content-Type set to mimeType), then call finalize_upload with the returned fileId to register the file.\n\nSupported types: application/pdf, image/png, image/jpeg, image/webp, image/gif. For text/code use upload_file; Office documents (.docx/.xlsx/.pptx) are unsupported — convert to PDF.',
        inputSchema: {
          type: 'object',
          properties: {
            name:     { type: 'string', description: 'Filename with extension (e.g. report.pdf, diagram.png)' },
            mimeType: { type: 'string', description: 'One of: application/pdf, image/png, image/jpeg, image/webp, image/gif' },
          },
          required: ['name', 'mimeType'],
        },
      },
      {
        name: 'finalize_upload',
        description: 'Register a binary file after its bytes have been PUT to the create_upload_url signed URL. Confirms the upload landed and records it (size + type read from storage). Returns the file id/name/mimeType, usable in file_ids on create_template or update_template. Call once per create_upload_url, after the PUT succeeds.',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'The fileId returned by create_upload_url' },
          },
          required: ['fileId'],
        },
      },
      {
        name: 'delete_file',
        description: 'Permanently delete a workspace file (from storage and the file list). Use this to clean up a context file that a template no longer needs — e.g. after replacing it via update_template, the old file stays in the workspace, unattached, until deleted.\n\nSAFETY: if the file is still attached to OTHER templates, the call is BLOCKED by default and returns the list of templates that use it, so you can confirm with the user before touching them. To then proceed, either:\n  • pass force:true to detach the file from every template and delete it, or\n  • pass replaceWith:<fileId> to swap the file for a replacement in each of those templates (detach old, attach new) and then delete the old file.\nAsk the user before using force or replaceWith. This cannot be undone.',
        inputSchema: {
          type: 'object',
          properties: {
            fileId:      { type: 'string', description: 'UUID of the workspace file to delete (from list_files).' },
            force:       { type: 'boolean', description: 'If the file is still attached to other templates, detach it from all of them and delete anyway. Default false — without it (and without replaceWith) the call is blocked and returns the referencing templates so you can confirm with the user first.' },
            replaceWith: { type: 'string', description: 'Optional UUID of a replacement file. When the file is attached to other templates, swap it for this file in each of them (detach old, attach new) instead of just detaching, then delete the old file. Implies force.' },
          },
          required: ['fileId'],
        },
      },
    ];

    // Only advertise tools the connection is scoped for (SQEM-064).
    const visibleTools = tools.filter((t) => scopes.includes(TOOL_CAPABILITY[t.name]));
    return rpcResult(id, { tools: visibleTools });
  }

  // ---- tools/call ----

  if (method === 'tools/call') {
    const toolName: string = params?.name;
    const args = params?.arguments || {};

    if (!toolName) return rpcError(id, -32602, 'Missing tool name');

    // Capability gate (SQEM-064): reject tools the connection isn't scoped for.
    const requiredCap = TOOL_CAPABILITY[toolName];
    if (requiredCap && !scopes.includes(requiredCap)) {
      return rpcError(id, -32002, `Insufficient scope: '${toolName}' requires the '${requiredCap}' permission, which this connection is not granted.`);
    }

    if (toolName === 'list_templates') {
      const kind = args.kind && args.kind !== 'all' ? args.kind : null;
      let query = adminClient
        .from('prompts')
        .select('id, title, description, kind, variables, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill') // SQEM-110/210 — vestigial guard, see above
        .order('title');
      if (kind) query = query.eq('kind', kind);
      const { data: templates } = await query;

      const visible = (templates || [])
        .filter((t: any) => canAccessTemplate(t.id)); // SQEM-142/210 — access-filtered (per user on OAuth, open-only on API keys)
      // SQEM-232 — stats computed AFTER the access filter, so a template the caller may not see
      // contributes nothing, not even its file count.
      const stats = await contextFileStats(adminClient, workspaceId, visible);

      const result = visible
        .map((t: any) => {
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

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === 'search_templates') {
      const query = (args.query || '').toLowerCase();
      if (!query) return rpcError(id, -32602, 'Missing search query');

      let dbQuery = adminClient
        .from('prompts')
        .select('id, title, description, kind, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard, see above
      if (args.kind) dbQuery = dbQuery.eq('kind', args.kind);
      const { data: templates } = await dbQuery;

      const matched = (templates || [])
        .filter((t: any) =>
          canAccessTemplate(t.id) && ( // SQEM-142/210 — access-filtered (per user on OAuth, open-only on API keys)
            t.title.toLowerCase().includes(query) ||
            (t.description || '').toLowerCase().includes(query)
          )
        );
      // SQEM-232 — only for the matches, so a search that hits nothing costs no extra query.
      const stats = await contextFileStats(adminClient, workspaceId, matched);

      const results = matched
        .map((t: any) => {
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

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] });
    }

    if (toolName === 'get_template') {
      const templateId   = args.id;
      const templateName = args.name;
      if (!templateId && !templateName) return rpcError(id, -32602, 'Provide either id or name');

      const { data: templates } = await adminClient
        .from('prompts')
        .select('id, title, description, kind, content, system_instruction, variables, context_file_ids')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill'); // SQEM-110/210 — vestigial guard, see above

      const tpl = templateId
        ? (templates || []).find((t: any) => t.id === templateId)
        : (templates || []).find((t: any) => toSlug(t.title) === templateName);

      if (!tpl || !canAccessTemplate(tpl.id)) return rpcError(id, -32602, 'Template not found'); // SQEM-142

      // SQEM-230 — how context files come back. Default stays `inline` so every existing caller
      // gets byte-identical output; an unknown value is rejected rather than silently treated as
      // the default, because a typo'd mode would look like it worked while doing the opposite.
      const includeFiles: string = args.include_files ?? 'inline';
      if (includeFiles !== 'inline' && includeFiles !== 'list') {
        return rpcError(id, -32602, `include_files must be "inline" or "list" (got "${includeFiles}")`);
      }

      // Text context files are inlined; binaries (PDF/images) are referenced by resource URI.
      let content = tpl.content || '';
      const resolved = await resolveContextFiles(adminClient, workspaceId, tpl.context_file_ids);
      for (const block of renderContextBlocks(resolved, includeFiles)) {
        content += `\n\n${block}`;
      }

      // In `inline` mode the shape is untouched — adding fields here would change every existing
      // caller's payload, which is exactly what the default is meant to prevent.
      //
      // Access note (SQEM-230, decided 2026-08-16): the uris below are read back through
      // `resources/read`, which authorises on `workspace_id` — NOT on template access. That is
      // deliberate and matches the product: `workspace_files` is a workspace-wide library
      // (SQEM-039, `workspace_files_select` grants every member every file), and one file may be
      // attached to several templates, so "which template decides?" has no answer. Do not "fix"
      // this into template-derived access without also filtering `resources/list` — otherwise a
      // caller could list a file it may not read.
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
      const result: any = {
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

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === 'list_files') {
      const { data: files } = await adminClient
        .from('workspace_files')
        .select('id, name, mime_type')
        .eq('workspace_id', workspaceId)
        .order('name');

      // SQEM-291 — the third way out, and the one easiest to miss: `resources/list` and
      // `resources/read` are the MCP resource surface, but `list_files` is a *tool* and reaches the
      // same rows by a different route. Closing two of three leaves the door open while the diff
      // looks complete.
      const result = (files || []).filter((f: any) => accessibleFileIds.has(f.id)).map((f: any) => ({
        id:       f.id,
        name:     f.name,
        mimeType: f.mime_type,
      }));

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === 'create_template') {
      const { kind, title, content, description, system_instruction, variables, file_ids } = args;

      if (!kind || !['prompt', 'assistant', 'skill'].includes(kind))
        return rpcError(id, -32602, 'kind must be one of: prompt, assistant, skill');
      if (!title?.trim())   return rpcError(id, -32602, 'title is required');
      if (content == null)  return rpcError(id, -32602, 'content is required');
      if (kind === 'skill' && !description?.trim())
        return rpcError(id, -32602, 'description is required for kind=skill — AI agents need it to discover the skill');

      // Resolve variables: explicit param takes precedence, then auto-extract from content
      let resolvedVars: any[] = [];
      if (kind === 'prompt') {
        if (Array.isArray(variables) && variables.length > 0) {
          resolvedVars = normaliseVariables(variables);
        } else {
          resolvedVars = extractVariables(content || '');
        }
      }

      // SQEM-240 — the owner (`created_by` below) and the workspace's default access. See
      // `workspaceRestrictsNewTemplates` for why both matter and what breaks without them.
      const restrictByDefault = await workspaceRestrictsNewTemplates(adminClient, workspaceId, mcpUserId);

      // SQEM-249 — a skill's body keeps only the frontmatter keys that are not ours. A model that
      // read a SKILL.md and passed the whole file lands here, header and all; storing it verbatim is
      // how the double-frontmatter export came about, and it also leaves a `title:` in the body that
      // contradicts the column the moment someone renames the skill. The author's own keys
      // (`license`, `metadata`, …) stay — they have nowhere else to live.
      const storedContent = kind === 'skill' ? withoutOwnFrontmatter(content || '') : (content || '');

      const { data: inserted, error: insertErr } = await adminClient
        .from('prompts')
        .insert({
          workspace_id:       workspaceId,
          kind,
          title:              title.trim(),
          content:            storedContent,
          description:        description?.trim() || '',
          system_instruction: system_instruction || null,
          variables:          resolvedVars,
          context_file_ids:   Array.isArray(file_ids) ? file_ids : [],
          created_by:         mcpUserId,
        })
        .select('id, title, kind')
        .single();

      if (insertErr || !inserted)
        return rpcError(id, -32603, `Failed to create template: ${insertErr?.message ?? 'unknown error'}`);

      if (restrictByDefault) {
        // The principal-less row: a restriction exists and nobody is named by it (SQEM-210), which
        // with `created_by` set above means the creator alone. Non-fatal on purpose — a template
        // that exists and is open is recoverable; failing the whole call after the row is already
        // inserted would leave the caller believing nothing happened.
        const { error: accessErr } = await adminClient
          .from('template_access')
          .insert({ template_id: inserted.id, workspace_id: workspaceId });
        if (accessErr) console.error('[mcp] SQEM-240 default access not applied', inserted.id, accessErr.message);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id:            inserted.id,
        name:          toSlug(inserted.title),
        title:         inserted.title,
        kind:          inserted.kind,
        argumentCount: resolvedVars.length,
        variables:     resolvedVars.map((v: any) => v.name),
        fileCount:     Array.isArray(file_ids) ? file_ids.length : 0,
        // SQEM-240 — report it rather than leave the caller guessing. Who can see a template the
        // agent just created is exactly the kind of thing a person wants told, not discovered.
        visibility:    restrictByDefault ? 'only-you' : 'everyone-in-workspace',
      }, null, 2) }] });
    }

    if (toolName === 'update_template') {
      const { id: templateId, title, content, description, system_instruction, variables, file_ids } = args;
      if (!templateId) return rpcError(id, -32602, 'id is required');

      const { data: existing } = await adminClient
        .from('prompts')
        .select('id, kind, content')
        .eq('workspace_id', workspaceId)
        .eq('id', templateId)
        .single();
      if (!existing) return rpcError(id, -32602, `Template not found: ${templateId}`);

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (title              !== undefined) updates.title              = title.trim();
      // SQEM-249 — same rule as create_template, and it has to be here too or an update re-introduces
      // the header that the create just removed.
      if (content            !== undefined) updates.content            = existing.kind === 'skill' ? withoutOwnFrontmatter(content) : content;
      if (description        !== undefined) updates.description        = description.trim();
      if (system_instruction !== undefined) updates.system_instruction = system_instruction;
      if (Array.isArray(file_ids))          updates.context_file_ids   = file_ids;

      // Variables: only for kind=prompt
      if (existing.kind === 'prompt') {
        if (Array.isArray(variables) && variables.length > 0) {
          updates.variables = normaliseVariables(variables);
        } else if (content !== undefined) {
          updates.variables = extractVariables(content ?? '');
        }
      }

      if (Object.keys(updates).length === 1)
        return rpcError(id, -32602, 'No fields to update — provide at least one of: title, content, description, system_instruction, variables, file_ids');

      const { data: updated, error: updateErr } = await adminClient
        .from('prompts')
        .update(updates)
        .eq('workspace_id', workspaceId)
        .eq('id', templateId)
        .select('id, title, kind')
        .single();

      if (updateErr || !updated)
        return rpcError(id, -32603, `Failed to update template: ${updateErr?.message ?? 'unknown error'}`);

      const updatedVars = updates.variables as any[] | undefined;
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id:    updated.id,
        name:  toSlug(updated.title),
        title: updated.title,
        kind:  updated.kind,
        ...(updatedVars !== undefined && {
          argumentCount: updatedVars.length,
          variables:     updatedVars.map((v: any) => v.name),
        }),
        ...(Array.isArray(file_ids) && { fileCount: file_ids.length }),
      }, null, 2) }] });
    }

    if (toolName === 'delete_template') {
      const templateId = args.id;
      if (!templateId) return rpcError(id, -32602, 'id is required');

      const { data: existing } = await adminClient
        .from('prompts')
        .select('id, title, kind')
        .eq('workspace_id', workspaceId)
        .eq('id', templateId)
        .single();
      if (!existing) return rpcError(id, -32602, `Template not found: ${templateId}`);

      const { error: deleteErr } = await adminClient
        .from('prompts')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', templateId);

      if (deleteErr)
        return rpcError(id, -32603, `Failed to delete template: ${deleteErr.message}`);

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        deleted: true,
        id:      existing.id,
        title:   existing.title,
        kind:    existing.kind,
      }, null, 2) }] });
    }

    // SQEM-248 — a skill folder arrives whole, because its bytes never pass through the model.
    //
    // The measurement that produced this tool: `diagram-design` was added over MCP and 26 of 152
    // files arrived. Not because anything rejected the rest — the paths, the extensions and the size
    // limits were all fine — but because 2 MB of file content cannot be emitted by a client that has
    // to hold a conversation as well. Any design that routes the bytes through the model has that
    // ceiling; this one does not, so the completeness question stops being a warning and becomes a
    // fact the server can state.
    if (toolName === 'import_skill_from_url') {
      const { url: rawUrl, path: pathArg } = args;
      if (!rawUrl?.trim()) return rpcError(id, -32602, 'url is required');

      let resolved: { archiveUrl: string; subPath: string | null };
      try { resolved = resolveArchiveUrl(rawUrl); }
      catch (err) { return rpcError(id, -32602, (err as Error).message); }

      let archive: Uint8Array;
      try { archive = await downloadArchive(resolved.archiveUrl); }
      catch (err) { return rpcError(id, -32603, `Could not download the archive: ${(err as Error).message}`); }

      let zip: JSZip;
      try { zip = await JSZip.loadAsync(archive); }
      catch { return rpcError(id, -32602, 'That URL did not return a readable zip archive.'); }

      const entryPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
      let root: string;
      try { root = findSkillRoot(entryPaths, pathArg ?? resolved.subPath); }
      catch (err) { return rpcError(id, -32602, (err as Error).message); }

      const head = readSkillMd(await zip.files[`${root}${SKILL_ENTRY}`].async('string'));
      if (!head.description.trim()) {
        // Same rule as create_template: a skill without a description cannot be discovered, and a
        // skill nobody finds is not an import worth completing.
        return rpcError(id, -32602,
          `${SKILL_ENTRY} has no "description" in its frontmatter. A skill needs one — AI agents use it to discover the skill. Add it and re-run, or import the folder through the Sqemes app and write one there.`);
      }

      // Everything beside SKILL.md, by relative path. Unsupported types are recorded, not fatal: a
      // skill that ships one .drawio should still arrive, and the report says what did not.
      const skipped: { name: string; reason: string }[] = [];
      // Indexed access rather than `JSZip.JSZipObject`: the namespace type resolves differently
      // under `npm:` specifiers, and nothing in CI type-checks this file to catch it.
      const members: { name: string; mimeType: string; storageMime: string; entry: (typeof zip.files)[string] }[] = [];
      for (const p of entryPaths) {
        if (!p.startsWith(root)) continue;
        const rel = p.slice(root.length);
        if (!rel || rel === SKILL_ENTRY || isArchiveJunk(rel)) continue;
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        const textMime = TEXT_MIME[ext];
        const mimeType = textMime ?? BINARY_EXT_MIME[ext];
        if (!mimeType) { skipped.push({ name: rel, reason: `unsupported file type .${ext}` }); continue; }
        // ⚠️ The bucket's own allowlist is far shorter than TEXT_MIME (see
        // `20260617000000_workspace_files.sql`: text/plain, text/csv, text/markdown and four binary
        // types). `upload_file` has always uploaded text as **text/plain** and kept the real type in
        // the row; this path skipped that and handed `text/html` to storage, which refused it — the
        // first real archive failed on `assets/example-bar-dark.html`. The row still carries the
        // truthful mime, which is what every reader uses.
        members.push({ name: rel, mimeType, storageMime: textMime ? STORAGE_TEXT_MIME : mimeType, entry: zip.files[p] });
      }

      if (members.length > SKILL_MAX_FILES) {
        return rpcError(id, -32602, `That skill holds ${members.length} files, over the ${SKILL_MAX_FILES} limit for one import.`);
      }

      // Storage first, rows second, template last — so a failure anywhere leaves nothing attached to
      // a half-built template. Uploaded objects are removed on the way out; an orphan in the bucket
      // that no row points at is invisible and permanent.
      const uploaded: { fileId: string; storagePath: string; name: string; mimeType: string; sizeBytes: number }[] = [];
      const cleanUp = async () => {
        if (uploaded.length) {
          await adminClient.storage.from('workspace-files').remove(uploaded.map((u) => u.storagePath));
        }
      };

      // SQEM-251 — every file carries the skill's folder in front of it. `workspace_files` is one
      // flat namespace per workspace with no unique constraint on the name, so without this the
      // second imported skill merges its `references/` into the first one's — guaranteed, and a
      // same-named file becomes an indistinguishable twin row.
      const folder = skillSlug(head.title);

      let unpackedBytes = 0;
      try {
        await mapLimit(members, SKILL_UPLOAD_CONCURRENCY, async (member) => {
          const bytes = await member.entry.async('uint8array');
          unpackedBytes += bytes.byteLength;
          if (unpackedBytes > SKILL_MAX_UNPACKED_BYTES) {
            throw new Error(`unpacks to more than ${SKILL_MAX_UNPACKED_BYTES / 1048576} MB`);
          }

          const fileId = crypto.randomUUID();
          const workspaceName = `${folder}/${member.name}`;
          // The path stays in `name` — that is the folder tree (SQEM-244). Only the storage key is
          // flattened (SQEM-111/237), and the two must not be confused for each other.
          const storagePath = `${workspaceId}/${fileId}/${safeStorageFileName(workspaceName)}`;
          const { error } = await adminClient.storage
            .from('workspace-files')
            .upload(storagePath, bytes, { contentType: member.storageMime });
          if (error) throw new Error(`${member.name}: ${error.message}`);
          uploaded.push({ fileId, storagePath, name: workspaceName, mimeType: member.mimeType, sizeBytes: bytes.byteLength });
        });
      } catch (err) {
        await cleanUp();
        return rpcError(id, -32603, `Import stopped, nothing was kept: ${(err as Error).message}`);
      }

      const { error: rowsErr } = await adminClient.from('workspace_files').insert(
        uploaded.map((u) => ({
          id: u.fileId,
          workspace_id: workspaceId,
          name: u.name,
          mime_type: u.mimeType,
          size_bytes: u.sizeBytes,
          storage_path: u.storagePath,
          tags: [],
        })),
      );
      if (rowsErr) {
        await cleanUp();
        return rpcError(id, -32603, `Import stopped, nothing was kept: ${rowsErr.message}`);
      }

      const restrictByDefault = await workspaceRestrictsNewTemplates(adminClient, workspaceId, mcpUserId);
      const { data: inserted, error: insertErr } = await adminClient
        .from('prompts')
        .insert({
          workspace_id:     workspaceId,
          kind:             'skill',
          title:            head.title.trim(),
          content:          head.content,
          description:      head.description.trim(),
          variables:        [],
          context_file_ids: uploaded.map((u) => u.fileId),
          created_by:       mcpUserId,
        })
        .select('id, title, kind')
        .single();

      if (insertErr || !inserted) {
        await adminClient.from('workspace_files').delete().in('id', uploaded.map((u) => u.fileId));
        await cleanUp();
        return rpcError(id, -32603, `Import stopped, nothing was kept: ${insertErr?.message ?? 'unknown error'}`);
      }

      if (restrictByDefault) {
        const { error: accessErr } = await adminClient
          .from('template_access')
          .insert({ template_id: inserted.id, workspace_id: workspaceId });
        if (accessErr) console.error('[mcp] SQEM-240 default access not applied', inserted.id, accessErr.message);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id:          inserted.id,
        title:       inserted.title,
        kind:        inserted.kind,
        source:      resolved.archiveUrl,
        skillFolder: root || '(archive root)',
        filesImported: uploaded.length,
        bytesImported: unpackedBytes,
        // Present even when empty: "skipped: []" is the sentence that makes a complete import
        // provable, and the absence of a warning is not the same thing.
        skipped,
      }, null, 2) }] });
    }

    if (toolName === 'upload_file') {
      const { name: fileName, content } = args;
      if (!fileName?.trim()) return rpcError(id, -32602, 'name is required');
      if (content == null)   return rpcError(id, -32602, 'content is required');

      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const mimeType = TEXT_MIME[ext];
      if (!mimeType) {
        return rpcError(id, -32602,
          `Unsupported file type ".${ext}" — upload_file accepts text/code only. ` +
          `PDFs and images can be uploaded via the Sqemes UI. ` +
          `Office documents (.docx/.xlsx/.pptx) aren't supported anywhere — convert to PDF first. ` +
          `Supported text types: ${Object.keys(TEXT_MIME).map(e => '.' + e).join(', ')}`
        );
      }

      const fileId      = crypto.randomUUID();
      const safeFileName = safeStorageFileName(fileName); // SQEM-111/237 — no path separators / .. in the storage key
      const storagePath = `${workspaceId}/${fileId}/${safeFileName}`;
      const blob        = new Blob([content], { type: 'text/plain' });
      const sizeBytes   = new TextEncoder().encode(content).length;

      const { error: uploadErr } = await adminClient.storage
        .from('workspace-files')
        .upload(storagePath, blob, { contentType: 'text/plain' });
      if (uploadErr) return rpcError(id, -32603, `Storage upload failed: ${uploadErr.message}`);

      const { data: inserted, error: insertErr } = await adminClient
        .from('workspace_files')
        .insert({
          id:                fileId,
          workspace_id:      workspaceId,
          name:              fileName,
          mime_type:         mimeType,
          size_bytes:        sizeBytes,
          storage_path:      storagePath,
          tags:              [],
        })
        .select('id, name, mime_type')
        .single();

      if (insertErr || !inserted) {
        await adminClient.storage.from('workspace-files').remove([storagePath]);
        return rpcError(id, -32603, `Failed to save file record: ${insertErr?.message ?? 'unknown error'}`);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id:       inserted.id,
        name:     inserted.name,
        mimeType: inserted.mime_type,
      }, null, 2) }] });
    }

    if (toolName === 'create_upload_url') {
      const { name: fileName, mimeType } = args;
      if (!fileName?.trim()) return rpcError(id, -32602, 'name is required');
      if (!mimeType)         return rpcError(id, -32602, 'mimeType is required');
      if (!BINARY_MIME.has(mimeType)) {
        return rpcError(id, -32602,
          `Unsupported binary type "${mimeType}". Supported: ${[...BINARY_MIME].join(', ')}. ` +
          `For text/code use upload_file; Office documents aren't supported — convert to PDF.`);
      }

      const fileId      = crypto.randomUUID();
      const safeFileName = safeStorageFileName(fileName); // SQEM-111/237 — no path separators / .. in the storage key
      const storagePath = `${workspaceId}/${fileId}/${safeFileName}`;

      const { data: signed, error: signErr } = await adminClient.storage
        .from('workspace-files')
        .createSignedUploadUrl(storagePath);
      if (signErr || !signed) {
        return rpcError(id, -32603, `Could not create upload URL: ${signErr?.message ?? 'unknown error'}`);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        fileId,
        uploadUrl:        signed.signedUrl,
        token:            signed.token,
        path:             storagePath,
        mimeType,
        expiresInSeconds: 7200,
        instructions:     'PUT the raw file bytes to uploadUrl with Content-Type set to mimeType, then call finalize_upload with this fileId.',
      }, null, 2) }] });
    }

    if (toolName === 'finalize_upload') {
      const { fileId } = args;
      if (!fileId?.trim()) return rpcError(id, -32602, 'fileId is required');

      // Idempotent: if already registered, return it.
      const { data: existing } = await adminClient
        .from('workspace_files')
        .select('id, name, mime_type')
        .eq('workspace_id', workspaceId)
        .eq('id', fileId)
        .maybeSingle();
      // SQEM-291 — the `fileId` comes from the caller, so a foreign one can be passed here. Without
      // the visibility check this branch answers with a name and a MIME type for a file the caller
      // cannot otherwise see: an idempotency shortcut that doubles as a lookup.
      if (existing && !accessibleFileIds.has(fileId)) {
        return rpcError(id, -32602, `File not found: ${fileId}`);
      }
      if (existing) {
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
          id: existing.id, name: existing.name, mimeType: existing.mime_type, alreadyRegistered: true,
        }, null, 2) }] });
      }

      // Find the uploaded object under this fileId's folder.
      const { data: objects, error: listErr } = await adminClient.storage
        .from('workspace-files')
        .list(`${workspaceId}/${fileId}`);
      if (listErr) return rpcError(id, -32603, `Could not read storage: ${listErr.message}`);

      const obj = (objects || []).find((o: any) => o.id && o.name);
      if (!obj) {
        return rpcError(id, -32602,
          'No uploaded file found for this fileId. PUT the bytes to the create_upload_url first.');
      }

      const storagePath = `${workspaceId}/${fileId}/${obj.name}`;
      const storedMime  = obj.metadata?.mimetype ?? 'application/octet-stream';
      const sizeBytes   = obj.metadata?.size ?? 0;

      if (!BINARY_MIME.has(storedMime)) {
        await adminClient.storage.from('workspace-files').remove([storagePath]);
        return rpcError(id, -32602, `Uploaded file type "${storedMime}" is not an accepted binary type.`);
      }

      const { data: inserted, error: insertErr } = await adminClient
        .from('workspace_files')
        .insert({
          id:           fileId,
          workspace_id: workspaceId,
          name:         obj.name,
          mime_type:    storedMime,
          size_bytes:   sizeBytes,
          storage_path: storagePath,
          tags:         [],
        })
        .select('id, name, mime_type')
        .single();
      if (insertErr || !inserted) {
        return rpcError(id, -32603, `Failed to register file: ${insertErr?.message ?? 'unknown error'}`);
      }

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id: inserted.id, name: inserted.name, mimeType: inserted.mime_type,
      }, null, 2) }] });
    }

    if (toolName === 'delete_file') {
      const { fileId, force, replaceWith } = args;
      if (!fileId?.trim()) return rpcError(id, -32602, 'fileId is required');
      if (replaceWith && replaceWith === fileId)
        return rpcError(id, -32602, 'replaceWith must be a different file than the one being deleted');

      // 1. The file must exist in this workspace **and be one this caller can see**.
      //
      // SQEM-291 — deleting is a write, but the leak here is a read: the two answers "File not
      // found" and "deleted" differ, so without this check the tool doubles as a way to test whether
      // a given id exists in the workspace. Same wording either way, so an invisible file is
      // indistinguishable from an absent one.
      if (!accessibleFileIds.has(fileId)) return rpcError(id, -32602, `File not found: ${fileId}`);

      const { data: file } = await adminClient
        .from('workspace_files')
        .select('id, name, storage_path')
        .eq('workspace_id', workspaceId)
        .eq('id', fileId)
        .maybeSingle();
      if (!file) return rpcError(id, -32602, `File not found: ${fileId}`);

      // 2. An optional replacement file must also exist in this workspace.
      let replacement: { id: string; name: string } | null = null;
      if (replaceWith) {
        const { data: rep } = await adminClient
          .from('workspace_files')
          .select('id, name')
          .eq('workspace_id', workspaceId)
          .eq('id', replaceWith)
          .maybeSingle();
        if (!rep || !accessibleFileIds.has(replaceWith))
          return rpcError(id, -32602, `replaceWith file not found: ${replaceWith}`);
        replacement = rep;
      }

      // 3. Which templates still reference this file? (context_file_ids is uuid[])
      const { data: refs } = await adminClient
        .from('prompts')
        .select('id, title, kind, context_file_ids')
        .eq('workspace_id', workspaceId)
        .contains('context_file_ids', [fileId]);
      const referencedBy = refs || [];

      // 4. Blocked: still attached elsewhere and no explicit force/replaceWith.
      //    Return the referencing templates so the assistant can confirm with the
      //    user before touching them (a tool can't prompt the user itself).
      if (referencedBy.length > 0 && !force && !replaceWith) {
        // SQEM-234 — the count is deliberately complete, the names are not. `referencedBy` comes
        // from the service role and therefore includes templates this caller has no access to;
        // returning their titles turned "try to delete a file" into a way to read the name of
        // someone else's private template. Same trade as the Files page, from the other side: the
        // number is what makes the file protectable, the title is what leaks.
        const nameable = referencedBy.filter((t: any) => canAccessTemplate(t.id));
        const restricted = referencedBy.length - nameable.length;
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
          deleted: false,
          blocked: true,
          reason: `This file is still attached to ${referencedBy.length} other template(s)${restricted > 0 ? `, ${restricted} of which you cannot see` : ''}. Confirm with the user before removing it from them.`,
          referencedBy: nameable.map((t: any) => ({ id: t.id, title: t.title, kind: t.kind })),
          ...(restricted > 0 ? { restrictedCount: restricted } : {}),
          howToProceed: 'Call delete_file again with force:true to detach the file from these templates and delete it, or replaceWith:<fileId> to swap in a replacement file for each of them first.',
        }, null, 2) }] });
      }

      // 5. Detach (or swap for the replacement) on every referencing template.
      const affected: { id: string; title: string; kind: string }[] = [];
      for (const t of referencedBy) {
        const current: string[] = t.context_file_ids || [];
        let next = replaceWith
          ? current.map((fid: string) => (fid === fileId ? replaceWith : fid))
          : current.filter((fid: string) => fid !== fileId);
        next = next.filter((fid: string, i: number) => next.indexOf(fid) === i); // de-dupe
        const { error: updErr } = await adminClient
          .from('prompts')
          .update({ context_file_ids: next, updated_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('id', t.id);
        if (updErr) return rpcError(id, -32603, `Failed to update template ${t.id}: ${updErr.message}`);
        affected.push({ id: t.id, title: t.title, kind: t.kind });
      }

      // 6. Delete the storage object, then the file row. Nothing references the
      //    file anymore, so no dangling uuid[] entries are left behind.
      await adminClient.storage.from('workspace-files').remove([file.storage_path]);
      const { error: delErr } = await adminClient
        .from('workspace_files')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', fileId);
      if (delErr) return rpcError(id, -32603, `Failed to delete file: ${delErr.message}`);

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        deleted: true,
        id:      file.id,
        name:    file.name,
        ...(replacement
          ? { replacedWith: replacement, reattachedTo: affected }
          : { detachedFrom: affected }),
      }, null, 2) }] });
    }

    return rpcError(id, -32602, `Unknown tool: ${toolName}`);
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
});
