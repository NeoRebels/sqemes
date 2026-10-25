import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  McpSession, sanitizeSchema, connectorFunctionName, toolResultText, loadConnectorTools, withConnectorTools, MCP_RESULT_MAX_CHARS,
} from '../../supabase/functions/_shared/mcpClient';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/** SQEM-584 — sqemes as an MCP client, so connectors work with every text model. */

/** A fake Streamable-HTTP MCP server. `sse` answers as event stream; `expireAfter` drops the session once. */
function fakeServer({ sse = false, pages = 1, expireOnce = false, tools = ['search', 'send.mail'] } = {}) {
  const calls: { method: string; session: string | null; auth: string | null }[] = [];
  let expired = !expireOnce;
  let sessionNo = 0;
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    const msg = JSON.parse(String(init.body));
    calls.push({ method: msg.method, session: h['mcp-session-id'] ?? null, auth: h.authorization ?? null });
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (msg.method === 'initialize') {
      sessionNo++;
      return reply({ protocolVersion: '2024-11-05', serverInfo: { name: 'fake' } }, msg.id, { 'mcp-session-id': `s${sessionNo}` });
    }
    if (!expired && msg.method === 'tools/call') { expired = true; return new Response('gone', { status: 404 }); }
    if (msg.method === 'tools/list') {
      const page = msg.params?.cursor ? Number(msg.params.cursor) : 0;
      const slice = page === 0 ? tools : [`more${page}`];
      return reply({ tools: slice.map(n => ({ name: n, description: `does ${n}`, inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } })), ...(page + 1 < pages ? { nextCursor: String(page + 1) } : {}) }, msg.id);
    }
    if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: `ran ${msg.params.name} with ${JSON.stringify(msg.params.arguments)}` }] }, msg.id);
    return reply({}, msg.id);
  });
  function reply(result: unknown, id: number, extra: Record<string, string> = {}) {
    const body = JSON.stringify({ jsonrpc: '2.0', id, result });
    return sse
      ? new Response(`event: message\ndata: ${body}\n\n`, { headers: { 'content-type': 'text/event-stream', ...extra } })
      : new Response(body, { headers: { 'content-type': 'application/json', ...extra } });
  }
  return { fetchImpl, calls };
}
const conn = (o: Partial<{ token: string | null; allowedTools: string[] | null; displayName: string }> = {}) =>
  ({ url: 'https://mcp.example/mcp', token: 'tok', displayName: 'Example', allowedTools: null, ...o });

describe('McpSession', () => {
  for (const sse of [false, true]) {
    it(`initialises once, carries the session and the token, lists and calls (${sse ? 'SSE' : 'JSON'})`, async () => {
      const { fetchImpl, calls } = fakeServer({ sse });
      const s = new McpSession(conn(), fetchImpl);
      expect((await s.listTools()).map(t => t.name)).toEqual(['search', 'send.mail']);
      expect(await s.callTool('search', { q: 'x' })).toBe('ran search with {"q":"x"}');
      expect(calls.map(c => c.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
      expect(calls.slice(1).every(c => c.session === 's1')).toBe(true);
      expect(calls.every(c => c.auth === 'Bearer tok')).toBe(true);
    });
  }
  it('an expired session (404) is re-initialised once and the call retried', async () => {
    const { fetchImpl, calls } = fakeServer({ expireOnce: true });
    const s = new McpSession(conn(), fetchImpl);
    expect(await s.callTool('search', { q: 'y' })).toContain('ran search');
    expect(calls.filter(c => c.method === 'initialize')).toHaveLength(2);
  });
  it('follows nextCursor pages and honours the allowed-tools selection (SQEM-438)', async () => {
    const { fetchImpl } = fakeServer({ pages: 3 });
    expect((await new McpSession(conn(), fetchImpl).listTools()).map(t => t.name)).toEqual(['search', 'send.mail', 'more1', 'more2']);
    const { fetchImpl: f2 } = fakeServer();
    expect((await new McpSession(conn({ allowedTools: ['search'] }), f2).listTools()).map(t => t.name)).toEqual(['search']);
  });
  it('no token, no authorization header', async () => {
    const { fetchImpl, calls } = fakeServer();
    await new McpSession(conn({ token: null }), fetchImpl).listTools();
    expect(calls.every(c => c.auth === null)).toBe(true);
  });
});

describe('the schema every provider accepts', () => {
  it('⛔ drops keywords Gemini rejects, keeps the shape', () => {
    const out = sanitizeSchema({
      $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false,
      properties: {
        q: { type: 'string', description: 'query', default: 'x', examples: ['a'] },
        limit: { type: ['integer', 'null'], minimum: 1 },
        when: { anyOf: [{ type: 'null' }, { type: 'string', format: 'date-time' }], description: 'since' },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        nested: { type: 'object', properties: { x: { $ref: '#/defs/x' } } },
      },
      required: ['q', 'ghost'],
    });
    expect(out).toEqual({
      type: 'object',
      properties: {
        q: { type: 'string', description: 'query' },
        limit: { type: 'integer' },
        when: { type: 'string', description: 'since', format: 'date-time' },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        nested: { type: 'object', properties: { x: { type: 'string' } } },
      },
      required: ['q'],
    });
    expect(JSON.stringify(out)).not.toMatch(/\$schema|additionalProperties|\$ref|anyOf|default|examples|minimum/);
  });
});

describe('names and results', () => {
  it('function names are unique per connector and within the provider rules', () => {
    expect(connectorFunctionName(0, 'send.mail')).toBe('mcp0__send_mail');
    expect(connectorFunctionName(12, 'x'.repeat(100))).toHaveLength(64);
    expect(connectorFunctionName(1, 'ä ö/ü')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('a result is text, other parts named, errors marked, length bounded', () => {
    expect(toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: '…' }] })).toBe('a\n\n[image omitted]');
    expect(toolResultText({ content: [{ type: 'text', text: 'boom' }], isError: true })).toBe('Tool error: boom');
    expect(toolResultText({ structuredContent: { n: 1 } })).toBe('{"n":1}');
    expect(toolResultText({ content: [{ type: 'text', text: 'x'.repeat(MCP_RESULT_MAX_CHARS + 5) }] })).toMatch(/\[Truncated:/);
  });
});

describe('loading and routing', () => {
  const base = (): ToolRuntime => ({
    definitions: [{ name: 'search_templates', description: 'lib', parameters: { type: 'object', properties: {} } }],
    maxRounds: 6, deadline: Date.now() + 1e6,
    stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false },
    execute: vi.fn(async () => 'library answer'),
  });
  it('⛔ a connector that fails to list is left out and named — the others still work', async () => {
    const ok = fakeServer();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) =>
      url.includes('dead') ? new Response('nope', { status: 401 }) : ok.fetchImpl(url, init));
    const loaded = await loadConnectorTools([conn({ displayName: 'Nifty' }), { ...conn({ displayName: 'Dead' }), url: 'https://dead/mcp' }], { fetchImpl });
    expect(loaded.failed).toEqual(['Dead']);
    expect(loaded.definitions.map(d => d.name)).toEqual(['mcp0__search', 'mcp0__send_mail']);
    expect(loaded.definitions[0].description).toBe('[Nifty] does search');
  });
  it('the merged runtime routes connector names to MCP and everything else to the library', async () => {
    const { fetchImpl } = fakeServer();
    const loaded = await loadConnectorTools([conn()], { fetchImpl });
    const lib = base();
    const rt = withConnectorTools(lib, loaded);
    expect(rt.definitions.map(d => d.name)).toEqual(['search_templates', 'mcp0__search', 'mcp0__send_mail']);
    expect(await rt.execute('mcp0__search', { q: 'z' })).toBe('ran search with {"q":"z"}');
    expect(await rt.execute('search_templates', {})).toBe('library answer');
    expect(rt.stats.calls).toBe(1); // the library counts its own; the connector call is counted here
    expect(rt.stats).toBe(lib.stats);
  });
  it('a failing connector call is a tool error the model can read, not a failed answer', async () => {
    const { fetchImpl } = fakeServer();
    const loaded = await loadConnectorTools([conn()], { fetchImpl });
    fetchImpl.mockImplementation(async () => new Response('down', { status: 500 }));
    const rt = withConnectorTools(base(), loaded);
    expect(await rt.execute('mcp0__search', { q: 'z' })).toMatch(/"error":"The connector did not answer/);
  });
});

describe('wiring', () => {
  const fn = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');
  it('connectors are resolved for every provider, and loaded for all but Claude/OpenAI', () => {
    expect(fn).toMatch(/const connectors = \(Array\.isArray\(connectorIds\) && connectorIds\.length > 0\)/);
    expect(fn).toMatch(/if \(tools && connectors\?\.length && provider !== 'claude' && provider !== 'openai'\)/);
    expect(fn).toMatch(/callGemini\(apiKey, modelId, instruction, messages, false, onDelta, runtime, cancel\.signal\)/);
    expect([...fn.matchAll(/onDelta, runtime, cancel\.signal\)\)/g)]).toHaveLength(4);
    expect(fn).toMatch(/if \(unreachable\.length\) result \+= connectorRefusedNotice\(unreachable\);/);
  });
});
