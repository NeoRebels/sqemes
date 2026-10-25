/**
 * SQEM-584 — sqemes as an MCP CLIENT for chat, so connectors work with every text model.
 *
 * ⛔ **Why this exists.** Claude (`mcp_servers`) and OpenAI (Responses `mcp` tools) call remote MCP
 * servers themselves; every other provider only knows function calling. Until this module, connectors
 * were therefore Claude/ChatGPT-only and showed "inactive" on Gemini, Grok, DeepSeek, Mistral,
 * OpenRouter and credits. Here we do what those two providers do server-side: list a connector's tools,
 * offer them as ordinary functions, and run `tools/call` when the model asks.
 *
 * The transport is Streamable HTTP, the same minimal client `manage-connectors` has used for its probe
 * since SQEM-149: POST JSON-RPC, answer as JSON or as SSE, carry `mcp-session-id`.
 *
 * Pure apart from the injected `fetch`, so tests/unit can drive every path.
 */
import type { ToolDefinition, ToolRuntime } from './libraryTools.ts';

export const MCP_PROTOCOL = '2024-11-05';
/** Handshake + list: two small round trips. A dead server must fail fast, not eat the answer's time. */
export const MCP_LIST_TIMEOUT_MS = 10_000;
/** One tool call. Real work happens here (a search, a mail fetch), so more room than the handshake. */
export const MCP_CALL_TIMEOUT_MS = 60_000;
/** A tool result goes back into every later request of the turn — bounded like the library's. */
export const MCP_RESULT_MAX_CHARS = 20_000;
/** At most this many pages of `tools/list`. A server with more is offering more than a model can use. */
const MAX_LIST_PAGES = 5;

export interface McpConnectorInput {
  url: string;
  token: string | null;
  /** What the person called it — shown in descriptions and in the "answered without" notice. */
  displayName: string;
  /** SQEM-438 — only these tools, when set. */
  allowedTools: string[] | null;
}

export interface McpTool { name: string; description?: string; inputSchema?: unknown }

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

async function readRpc(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (ct.includes('application/json')) { try { return JSON.parse(text); } catch { return null; } }
  // SSE: the JSON-RPC answer rides `data:` lines; the last parseable one is the response.
  const payloads = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean);
  for (const p of payloads.reverse()) { try { return JSON.parse(p); } catch { /* keep scanning */ } }
  return null;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/** One connector's session: initialize once, then list and call; re-initialize once if it expired. */
export class McpSession {
  private session: string | null = null;
  private ready = false;
  private nextId = 1;
  constructor(private c: McpConnectorInput, private fetchImpl: Fetch = fetch) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    if (this.c.token) h.authorization = `Bearer ${this.c.token}`;
    if (this.session) h['mcp-session-id'] = this.session;
    return h;
  }

  private async post(body: unknown, signal: AbortSignal): Promise<Response> {
    return await this.fetchImpl(this.c.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
  }

  private async init(signal: AbortSignal): Promise<void> {
    this.session = null;
    const res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: 'sqemes', version: '1.0' } } }, signal);
    if (!res.ok) throw new Error(`initialize → HTTP ${res.status}`);
    this.session = res.headers.get('mcp-session-id') || null;
    const body = await readRpc(res);
    if (body?.error) throw new Error(`initialize: ${body.error.message || 'error'}`);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, signal).then(r => r.text()).catch(() => {});
    this.ready = true;
  }

  /** A request; a 404 on an established session means it expired — re-initialize once and retry. */
  private async request(method: string, params: unknown, signal: AbortSignal): Promise<any> {
    if (!this.ready) await this.init(signal);
    let res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, signal);
    if (res.status === 404 && this.session) {
      await this.init(signal);
      res = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, signal);
    }
    if (!res.ok) throw new Error(`${method} → HTTP ${res.status}`);
    const body = await readRpc(res);
    if (body?.error) throw new Error(`${method}: ${body.error.message || 'error'}`);
    return body?.result;
  }

  async listTools(signal?: AbortSignal): Promise<McpTool[]> {
    const s = withTimeout(signal, MCP_LIST_TIMEOUT_MS);
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.request('tools/list', cursor ? { cursor } : {}, s);
      for (const t of result?.tools ?? []) if (t && typeof t.name === 'string') out.push(t);
      cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }
    const allowed = this.c.allowedTools;
    return allowed ? out.filter(t => allowed.includes(t.name)) : out;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const result = await this.request('tools/call', { name, arguments: args }, withTimeout(signal, MCP_CALL_TIMEOUT_MS));
    return toolResultText(result);
  }
}

/** A `tools/call` result as text for the model: text parts joined, other parts named, bounded. */
export function toolResultText(result: any): string {
  const parts: string[] = [];
  for (const p of Array.isArray(result?.content) ? result.content : []) {
    if (p?.type === 'text' && typeof p.text === 'string') parts.push(p.text);
    else if (p?.type === 'resource' && typeof p.resource?.text === 'string') parts.push(p.resource.text);
    else if (p?.type) parts.push(`[${p.type} omitted]`);
  }
  if (!parts.length && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  let text = parts.join('\n\n') || '(no content)';
  if (result?.isError) text = `Tool error: ${text}`;
  if (text.length > MCP_RESULT_MAX_CHARS) {
    text = `${text.slice(0, MCP_RESULT_MAX_CHARS)}\n\n[Truncated: the tool returned ${text.length} characters, only the first ${MCP_RESULT_MAX_CHARS} are shown.]`;
  }
  return text;
}

/**
 * ⛔ **The JSON Schema subset every provider accepts.** Gemini validates function declarations against
 * its own OpenAPI subset and rejects the WHOLE request on an unknown keyword (see `ToolDefinition`);
 * MCP servers write full JSON Schema. Kept: type, description, enum, properties, required, items,
 * format, nullable. `anyOf`/`oneOf` collapse to their first non-null branch; `type: [x, 'null']` to x.
 */
export function sanitizeSchema(schema: unknown, depth = 0): Record<string, unknown> {
  const s = (schema && typeof schema === 'object' ? schema : {}) as Record<string, any>;
  if (depth > 8) return { type: 'string' };
  const branch = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(branch) && branch.length) {
    const pick = branch.find(b => (b as any)?.type !== 'null') ?? branch[0];
    return sanitizeSchema({ ...(pick as object), description: s.description ?? (pick as any)?.description }, depth);
  }
  let type = s.type;
  if (Array.isArray(type)) type = type.find((t: unknown) => t !== 'null') ?? 'string';
  if (!type) type = s.properties ? 'object' : s.items ? 'array' : 'string';
  const out: Record<string, unknown> = { type };
  if (typeof s.description === 'string') out.description = s.description.slice(0, 1000);
  if (Array.isArray(s.enum) && s.enum.every((e: unknown) => typeof e === 'string')) out.enum = s.enum;
  if (typeof s.format === 'string' && ['date-time', 'date', 'enum'].includes(s.format)) out.format = s.format;
  if (type === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) props[k] = sanitizeSchema(v, depth + 1);
    out.properties = props;
    if (Array.isArray(s.required)) {
      const req = s.required.filter((r: unknown) => typeof r === 'string' && r in props);
      if (req.length) out.required = req;
    }
  }
  if (type === 'array') out.items = sanitizeSchema(s.items ?? { type: 'string' }, depth + 1);
  return out;
}

/** `mcp<i>__<tool>`: unique per connector, within the 64-character, `[A-Za-z0-9_-]` function-name rules. */
export function connectorFunctionName(index: number, toolName: string): string {
  return `mcp${index}__${toolName.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64);
}

export interface LoadedConnectorTools {
  definitions: ToolDefinition[];
  /** Function name → which session and which MCP tool. */
  routes: Map<string, { session: McpSession; tool: string }>;
  /** Display names of connectors whose tools could not be listed — named under the answer. */
  failed: string[];
}

/** List every connector's tools in parallel; a connector that fails is left out, not fatal. */
export async function loadConnectorTools(
  connectors: McpConnectorInput[],
  { signal, fetchImpl }: { signal?: AbortSignal; fetchImpl?: Fetch } = {},
): Promise<LoadedConnectorTools> {
  const definitions: ToolDefinition[] = [];
  const routes = new Map<string, { session: McpSession; tool: string }>();
  const failed: string[] = [];
  const results = await Promise.allSettled(connectors.map(async (c) => {
    const session = new McpSession(c, fetchImpl);
    return { c, session, tools: await session.listTools(signal) };
  }));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed.push(connectors[i].displayName);
      console.warn('[chat-mcp] could not list tools of', connectors[i].displayName, String(r.reason?.message ?? r.reason).slice(0, 200));
      return;
    }
    for (const t of r.value.tools) {
      const name = connectorFunctionName(i, t.name);
      if (routes.has(name)) continue; // two tools that sanitise to one name: the first wins
      routes.set(name, { session: r.value.session, tool: t.name });
      const params = sanitizeSchema(t.inputSchema ?? { type: 'object', properties: {} });
      definitions.push({
        name,
        description: `[${r.value.c.displayName}] ${t.description ?? t.name}`.slice(0, 1024),
        parameters: (params.type === 'object' ? params : { type: 'object', properties: {} }) as ToolDefinition['parameters'],
      });
    }
  });
  return { definitions, routes, failed };
}

/**
 * The library runtime plus the connectors' tools: one list for the model, one loop, one budget.
 * ⚠️ The stats object is the library's own, so the `[chat-tools]` log line counts connector calls too.
 */
export function withConnectorTools(runtime: ToolRuntime, loaded: LoadedConnectorTools, signal?: AbortSignal): ToolRuntime {
  if (!loaded.definitions.length) return runtime;
  return {
    ...runtime,
    definitions: [...runtime.definitions, ...loaded.definitions],
    stats: runtime.stats,
    async execute(name, args) {
      const route = loaded.routes.get(name);
      if (!route) return runtime.execute(name, args);
      runtime.stats.calls += 1;
      runtime.stats.byTool[name] = (runtime.stats.byTool[name] ?? 0) + 1;
      try {
        return await route.session.callTool(route.tool, args, signal);
      } catch (e) {
        if (signal?.aborted) throw e; // Stop (SQEM-583) ends the turn, it is not a tool error
        return JSON.stringify({ error: `The connector did not answer: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
  };
}
