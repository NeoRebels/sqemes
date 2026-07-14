import { createAdminClient } from '../_shared/supabase-admin.ts';
import { isWorkspaceSubscriptionActive } from '../_shared/subscription.ts';

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
  upload_file:       'create',
  create_upload_url: 'create',
  finalize_upload:   'create',
  update_template:   'update',
  delete_template:   'delete',
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
): Promise<Array<{ id: string; name: string; mimeType: string; uri: string; text: string | null }>> {
  if (!fileIds?.length) return [];
  const { data: files } = await client
    .from('workspace_files')
    .select('id, name, mime_type, storage_path')
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
      text,
    });
  }
  return resolved;
}

// Renders resolved context files as prompt text: text inline, binaries as a URI reference.
function renderContextBlocks(
  resolved: Array<{ name: string; mimeType: string; uri: string; text: string | null }>,
): string[] {
  return resolved.map(f =>
    f.text != null
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
    .select('id, workspace_id, name, scopes, expires_at, is_oauth')
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

  // 3. Route methods

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_VERSION,
      capabilities: { prompts: {}, resources: {}, tools: {} },
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
      // SQEM-110 — MCP exposes only published templates; skills are agent-facing so stay
      // visible while unpublished (matches TemplateLaunchModal). Drafts must not leak via MCP.
      .or('published.eq.true,kind.eq.skill')
      .order('title');

    const prompts = (templates || []).map((t: any) => ({
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
      .select('id, title, description, content, system_instruction, variables, skill_ids, context_file_ids, kind')
      .eq('workspace_id', workspaceId)
      .or('published.eq.true,kind.eq.skill'); // SQEM-110 — no draft fetch/execute via MCP (skills exempt)

    const template = (templates || []).find((t: any) => toSlug(t.title) === name);
    if (!template) return rpcError(id, -32602, `Prompt not found: ${name}`);

    const resolvedInputs: Record<string, string> = {};
    for (const v of (template.variables || [])) {
      if (v.type === 'file') continue;
      resolvedInputs[v.name] = args[v.name] ?? v.defaultValue ?? '';
    }

    const skillParts: string[] = [];
    if (template.skill_ids?.length > 0) {
      const { data: skills } = await adminClient
        .from('prompts')
        .select('id, title, content, context_file_ids')
        .eq('workspace_id', workspaceId)
        .in('id', template.skill_ids);

      for (const skill of (skills || [])) {
        let skillText = `<skill: ${toSlug(skill.title)}>\n${skill.content || ''}\n</skill>`;

        const skillFiles = await resolveContextFiles(adminClient, workspaceId, skill.context_file_ids);
        for (const block of renderContextBlocks(skillFiles)) {
          skillText += `\n\n${block}`;
        }

        skillParts.push(skillText);
      }
    }

    const resolvedContext = await resolveContextFiles(adminClient, workspaceId, template.context_file_ids);
    const contextParts: string[] = renderContextBlocks(resolvedContext);

    const renderedContent = substituteVariables(template.content || '', resolvedInputs);

    const parts: string[] = [];
    if (skillParts.length > 0) parts.push(skillParts.join('\n\n'));
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

    const resources = (files || []).map((f: any) => ({
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
        description: 'List all templates in the workspace. Optionally filter by kind (prompt, skill, assistant).',
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
        description: 'Search templates by title or description keyword.',
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
        description: 'Get the full content, variables, and metadata of any template (prompt, assistant, or skill) by id or name slug. Text context files are inlined into the content; binary files (PDF, images) are listed in "contextFiles" with a resource "uri" — fetch their bytes with resources/read. Use this to inspect a template before updating it, or to consume a skill\'s full knowledge.',
        inputSchema: {
          type: 'object',
          properties: {
            id:   { type: 'string', description: 'UUID of the template (from list_templates or search_templates)' },
            name: { type: 'string', description: 'Slug name of the template (from list_templates or search_templates)' },
          },
        },
      },
      {
        name: 'list_files',
        description: 'List all workspace files with their IDs. Use file IDs with create_template or update_template to attach context files to a template.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'create_template',
        description: 'Create a new template (prompt, assistant, or skill) in the workspace.\n\nVariables (kind=prompt only): pass a "variables" array of {name, label?, type?} objects. Alternatively, write {{variable_name}} placeholders in content and they are auto-extracted. "type" can be "text" (default) or "textarea" for longer inputs.\nExample: [{"name":"draft","label":"Email Draft","type":"textarea"},{"name":"tone","type":"text"}]\n\nContext files: pass "file_ids" (array of UUIDs from list_files) to attach workspace files as context.',
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
        name: 'upload_file',
        description: 'Upload a text file into the workspace so it can be attached to templates via file_ids.\n\nSupported types: .txt .md .mdx .rst .json .yaml .yml .toml .csv .xml .html .css .scss .sass .sql .js .ts .jsx .tsx .mjs .py .rb .go .rs .java .php .swift .kt .c .cpp .cs .sh .bash\n\nFor PDFs and images use create_upload_url + finalize_upload (binary, uploaded out of band). Office documents (.docx/.xlsx/.pptx) are not supported — convert to PDF.\n\nThe returned id can be used directly in file_ids on create_template or update_template without a follow-up list_files call.',
        inputSchema: {
          type: 'object',
          properties: {
            name:    { type: 'string', description: 'Filename with extension (e.g. analyze_survey.js, schema.json)' },
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
        .select('id, title, description, kind, variables')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill') // SQEM-110 — no drafts via MCP (skills exempt)
        .order('title');
      if (kind) query = query.eq('kind', kind);
      const { data: templates } = await query;

      const result = (templates || []).map((t: any) => ({
        id:            t.id,
        name:          toSlug(t.title),
        title:         t.title,
        kind:          t.kind,
        description:   t.description || '',
        argumentCount: (t.variables || []).filter((v: any) => v.type !== 'file').length,
      }));

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === 'search_templates') {
      const query = (args.query || '').toLowerCase();
      if (!query) return rpcError(id, -32602, 'Missing search query');

      let dbQuery = adminClient
        .from('prompts')
        .select('id, title, description, kind')
        .eq('workspace_id', workspaceId)
        .or('published.eq.true,kind.eq.skill'); // SQEM-110 — no drafts via MCP (skills exempt)
      if (args.kind) dbQuery = dbQuery.eq('kind', args.kind);
      const { data: templates } = await dbQuery;

      const results = (templates || [])
        .filter((t: any) =>
          t.title.toLowerCase().includes(query) ||
          (t.description || '').toLowerCase().includes(query)
        )
        .map((t: any) => ({
          id:          t.id,
          name:        toSlug(t.title),
          title:       t.title,
          kind:        t.kind,
          description: t.description || '',
        }));

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
        .or('published.eq.true,kind.eq.skill'); // SQEM-110 — no draft fetch via MCP (skills exempt)

      const tpl = templateId
        ? (templates || []).find((t: any) => t.id === templateId)
        : (templates || []).find((t: any) => toSlug(t.title) === templateName);

      if (!tpl) return rpcError(id, -32602, 'Template not found');

      // Text context files are inlined; binaries (PDF/images) are referenced by resource URI.
      let content = tpl.content || '';
      const resolved = await resolveContextFiles(adminClient, workspaceId, tpl.context_file_ids);
      for (const block of renderContextBlocks(resolved)) {
        content += `\n\n${block}`;
      }
      const contextFiles = resolved.map(f => ({ name: f.name, uri: f.uri, mimeType: f.mimeType }));

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

      const result = (files || []).map((f: any) => ({
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

      const { data: inserted, error: insertErr } = await adminClient
        .from('prompts')
        .insert({
          workspace_id:       workspaceId,
          kind,
          title:              title.trim(),
          content:            content || '',
          description:        description?.trim() || '',
          system_instruction: system_instruction || null,
          variables:          resolvedVars,
          context_file_ids:   Array.isArray(file_ids) ? file_ids : [],
        })
        .select('id, title, kind')
        .single();

      if (insertErr || !inserted)
        return rpcError(id, -32603, `Failed to create template: ${insertErr?.message ?? 'unknown error'}`);

      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id:            inserted.id,
        name:          toSlug(inserted.title),
        title:         inserted.title,
        kind:          inserted.kind,
        argumentCount: resolvedVars.length,
        variables:     resolvedVars.map((v: any) => v.name),
        fileCount:     Array.isArray(file_ids) ? file_ids.length : 0,
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
      if (content            !== undefined) updates.content            = content;
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
      const safeFileName = fileName.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_'); // SQEM-111 — no path separators / .. in the storage key
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
      const safeFileName = fileName.replace(/[/\\]/g, '_').replace(/\.{2,}/g, '_'); // SQEM-111 — no path separators / .. in the storage key
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

    return rpcError(id, -32602, `Unknown tool: ${toolName}`);
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
});
