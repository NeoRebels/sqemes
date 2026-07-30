// SQEM-159 — Notion MCP shim. Stateless MCP server → Notion REST API. The passthrough sends the store's
// internal-integration token (`ntn_…`) as bearer; the shim re-sends it as Notion's Authorization header
// + the required Notion-Version. Read-only. Notion's own hosted MCP is OAuth-DCR-only (no static token),
// so a REST shim with a pasted internal token is the cheaper path (SQEM-159 research).
const NOTION = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const clip = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};

const TOOLS = [
  {
    name: 'search',
    description: 'Search pages and databases the integration can access. Omit query to list everything shared with it.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search text (optional).' }, filter: { type: 'string', enum: ['page', 'database'], description: 'Restrict to pages or databases (optional).' }, limit: { type: 'number', description: 'Max results (default 10, max 25).' } } },
  },
  {
    name: 'query_database',
    description: 'Query a Notion database\'s rows (pages) by database id.',
    inputSchema: { type: 'object', properties: { databaseId: { type: 'string', description: 'Database id.' }, limit: { type: 'number', description: 'Max rows (default 10, max 25).' } }, required: ['databaseId'] },
  },
  {
    name: 'get_page',
    description: 'Get a page\'s properties (title, metadata) by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Page id.' } }, required: ['id'] },
  },
  {
    name: 'get_block_children',
    description: 'Get the content blocks of a page/block by id (the page body).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Page or block id.' }, limit: { type: 'number', description: 'Max blocks (default 25, max 100).' } }, required: ['id'] },
  },
];

async function notion(method: string, path: string, token: string, body?: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${NOTION}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Notion ${res.status}`);
  return json;
}

// Flatten the common "title"/"rich_text" shapes to plain strings so tool output is compact + readable.
const plainTitle = (props: any): string | undefined => { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const v of Object.values(props ?? {})) {
    const p = v as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (p?.type === 'title') return (p.title ?? []).map((t: any) => t.plain_text).join(''); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return undefined;
};

const searchItem = (r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id,
  object: r.object,
  title: r.object === 'database' ? (r.title ?? []).map((t: any) => t.plain_text).join('') : plainTitle(r.properties), // eslint-disable-line @typescript-eslint/no-explicit-any
  url: r.url,
  lastEdited: r.last_edited_time,
});

async function runTool(name: string, args: Record<string, unknown>, token: string): Promise<string> {
  switch (name) {
    case 'search': {
      const body: Record<string, unknown> = { page_size: clip(args.limit, 10, 25) };
      if (typeof args.query === 'string' && args.query) body.query = args.query;
      if (args.filter === 'page' || args.filter === 'database') body.filter = { property: 'object', value: args.filter };
      const data = await notion('POST', '/search', token, body);
      return JSON.stringify((data.results ?? []).map(searchItem));
    }
    case 'query_database': {
      const id = encodeURIComponent(String(args.databaseId ?? ''));
      const data = await notion('POST', `/databases/${id}/query`, token, { page_size: clip(args.limit, 10, 25) });
      return JSON.stringify((data.results ?? []).map((p: any) => ({ id: p.id, title: plainTitle(p.properties), url: p.url, lastEdited: p.last_edited_time }))); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    case 'get_page': {
      const id = encodeURIComponent(String(args.id ?? ''));
      const p = await notion('GET', `/pages/${id}`, token);
      return JSON.stringify({ id: p.id, title: plainTitle(p.properties), url: p.url, properties: p.properties, lastEdited: p.last_edited_time });
    }
    case 'get_block_children': {
      const id = encodeURIComponent(String(args.id ?? ''));
      const data = await notion('GET', `/blocks/${id}/children?page_size=${clip(args.limit, 25, 100)}`, token);
      // Reduce each block to its type + plain text where present.
      const blocks = (data.results ?? []).map((b: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const rich = b[b.type]?.rich_text;
        return { id: b.id, type: b.type, text: Array.isArray(rich) ? rich.map((t: any) => t.plain_text).join('') : undefined, hasChildren: b.has_children }; // eslint-disable-line @typescript-eslint/no-explicit-any
      });
      return JSON.stringify(blocks);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { msg = await req.json(); } catch { return new Response('Bad Request', { status: 400, headers: cors }); }

  const json = (id: unknown, payload: Record<string, unknown>) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id, ...payload }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  if (msg.method?.startsWith('notifications/') || msg.id === undefined || msg.id === null) {
    return new Response(null, { status: 202, headers: cors });
  }

  switch (msg.method) {
    case 'initialize':
      return json(msg.id, {
        result: {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'sqemes-notion', version: '1.0.0' },
        },
      });
    case 'ping':
      return json(msg.id, { result: {} });
    case 'tools/list':
      return json(msg.id, { result: { tools: TOOLS } });
    case 'tools/call': {
      if (!token) return json(msg.id, { result: { content: [{ type: 'text', text: 'Not connected: missing Notion token.' }], isError: true } });
      try {
        const text = await runTool(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>, token);
        return json(msg.id, { result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return json(msg.id, { result: { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
      }
    }
    default:
      return json(msg.id, { error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});
