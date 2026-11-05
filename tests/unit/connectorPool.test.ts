import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ConnectorPool, withConnectorPool, connectorLabels, useConnectorDefinition, connectorsFetchedNotice,
  USE_CONNECTOR_TOOL, type AvailableConnector,
} from '../../supabase/functions/_shared/connectorPool';
import { createLibraryToolRuntime, advanceToolRound, type ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { connectorServiceKey } from '../../supabase/functions/_shared/connectorService';
import type { LoadedConnectorTools } from '../../supabase/functions/_shared/mcpClient';
import { en, de } from './i18nText';

/**
 * SQEM-651 — the model sees every connected service by name and fetches one when it needs it.
 * Decided 2026-11-04: automatic, no lock, the chat switches go.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const ME = 'user-me';
const avail = (id: string, name: string, user_id: string | null = null, url = `https://${id}.example.com/mcp`): AvailableConnector =>
  ({ id, name, mcp_url: url, provider: 'mcp', user_id });

type C = { id: string; displayName: string; name: string };
const resolved = (ids: string[], list: AvailableConnector[]): C[] =>
  ids.map(id => ({ id, displayName: list.find(a => a.id === id)!.name, name: `c_${id}` }));

function baseRuntime(): ToolRuntime {
  return {
    definitions: [{ name: 'search_templates', description: 'x', parameters: { type: 'object', properties: {} } }],
    maxRounds: 40, deadline: Date.now() + 90_000, callCounts: {}, lastResults: new Map(),
    stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [], stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0 },
    execute: vi.fn(async (name: string) => `ran ${name}`),
  };
}

describe('labels and the tool', () => {
  it('two connectors with one name get distinct labels', () => {
    const labels = connectorLabels([avail('a', 'Shopify'), avail('b', 'Shopify'), avail('c', 'Gmail')]);
    expect([...labels.keys()]).toEqual(['Shopify', 'Shopify (2)', 'Gmail']);
    expect(labels.get('Shopify (2)')!.id).toBe('b');
  });
  it('the tool lists the services by name — no address, no id', () => {
    const def = useConnectorDefinition(['Chatarmin', 'Gmail']);
    expect(def.name).toBe(USE_CONNECTOR_TOOL);
    expect(def.description).toContain('Services: Chatarmin, Gmail.');
    expect((def.parameters.properties.service as any).enum).toEqual(['Chatarmin', 'Gmail']);
    expect(JSON.stringify(def)).not.toMatch(/https?:|example\.com/);
  });
  it('the line under the answer, in both languages', () => {
    expect(connectorsFetchedNotice([])).toBe('');
    expect(connectorsFetchedNotice(['Chatarmin'])).toContain('Connected for this chat: Chatarmin.');
    expect(connectorsFetchedNotice(['Chatarmin'], 'de')).toContain('Für diesen Chat zugeschaltet: Chatarmin.');
    expect(en.chat_connectors_fetched && de.chat_connectors_fetched).toBeTruthy();
  });
});

describe('fetching on Claude and OpenAI (they run MCP themselves)', () => {
  const list = [avail('a', 'Chatarmin'), avail('b', 'Gmail')];
  const make = (initial: C[] = []) => {
    const resolve = vi.fn(async (ids: string[]) => resolved(ids, list));
    const pool = new ConnectorPool<C>(list, initial, { resolve });
    return { pool, resolve, rt: withConnectorPool(baseRuntime(), pool) };
  };

  it('nothing to offer ⇒ the runtime is unchanged', () => {
    const rt = baseRuntime();
    expect(withConnectorPool(rt, new ConnectorPool<C>([], [], { resolve: async () => [] }))).toBe(rt);
  });
  it('the first request carries only the names, not a connector', () => {
    const { pool, rt } = make();
    expect(rt.definitions.map(d => d.name)).toEqual(['search_templates', USE_CONNECTOR_TOOL]);
    expect(pool.active).toEqual([]);
  });
  it('use_connector fetches exactly that one, once, and its token is resolved only then', async () => {
    const { pool, resolve, rt } = make();
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'Chatarmin' })).toMatch(/connected for this chat/);
    expect(resolve).toHaveBeenCalledWith(['a']);
    expect(pool.added.map(c => c.id)).toEqual(['a']);
    expect(pool.fetchedNames).toEqual(['Chatarmin']);
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'chatarmin' })).toMatch(/already available/);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(rt.stats.byTool[USE_CONNECTOR_TOOL]).toBe(2);
  });
  it('a service that is not listed is refused, and nothing is resolved', async () => {
    const { resolve, rt } = make();
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'Salesforce' })).toMatch(/Unknown service/);
    expect(resolve).not.toHaveBeenCalled();
  });
  it('a connector the request already carried is not fetched again', async () => {
    const { pool, resolve, rt } = make(resolved(['b'], list));
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'Gmail' })).toMatch(/already available/);
    expect(resolve).not.toHaveBeenCalled();
    expect(pool.activeIds()).toEqual(['b']);
  });
  it('⛔ an id that is not in the list is never resolved, whoever asks', async () => {
    const { pool, resolve } = make();
    expect(await pool.fetch(['someone-elses'])).toEqual({ added: [], failed: [] });
    expect(resolve).not.toHaveBeenCalled();
  });
  it('other tools still reach the library', async () => {
    const { rt } = make();
    expect(await rt.execute('search_templates', {})).toBe('ran search_templates');
  });
});

describe('fetching on every other provider (tools as functions)', () => {
  const list = [avail('a', 'Chatarmin'), avail('b', 'Gmail')];
  const callTool = vi.fn(async () => '{"rows":3}');
  const load = vi.fn(async (cs: C[], offset: number): Promise<LoadedConnectorTools> => ({
    definitions: cs.map((c, i) => ({ name: `mcp${offset + i}__list`, description: `[${c.displayName}] list`, parameters: { type: 'object' as const, properties: {} } })),
    routes: new Map(cs.map((c, i) => [`mcp${offset + i}__list`, { session: { callTool } as any, tool: 'list' }])),
    failed: [],
  }));

  it('the fetched tools reach the NEXT round — also through the copies the loop makes', async () => {
    const pool = new ConnectorPool<C>(list, [], { resolve: async ids => resolved(ids, list), load }, { loadOffset: 1 });
    let rt: ToolRuntime | null = withConnectorPool(baseRuntime(), pool);
    rt = advanceToolRound(rt!, ['search_templates']); // `{ ...tools }` and the like keep the same array
    await rt!.execute(USE_CONNECTOR_TOOL, { service: 'Gmail' });
    expect(load).toHaveBeenCalledWith([expect.objectContaining({ id: 'b' })], 1); // numbered after the one already loaded
    expect(rt!.definitions.map(d => d.name)).toContain('mcp1__list');
    expect(await rt!.execute('mcp1__list', {})).toBe('{"rows":3}');
    expect(callTool).toHaveBeenCalledWith('list', {}, undefined);
  });
  it('a connector whose tools cannot be listed does not join, and is named', async () => {
    const failing = vi.fn(async (): Promise<LoadedConnectorTools> => ({ definitions: [], routes: new Map(), failed: ['Gmail'] }));
    const pool = new ConnectorPool<C>(list, [], { resolve: async ids => resolved(ids, list), load: failing });
    const rt = withConnectorPool(baseRuntime(), pool);
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'Gmail' })).toMatch(/Could not reach Gmail/);
    expect(pool.active).toEqual([]);
    expect(pool.failed).toEqual(['Gmail']);
  });
  it('after the provider refused connector tools, nothing more is fetched', async () => {
    const pool = new ConnectorPool<C>(list, [], { resolve: async ids => resolved(ids, list), load });
    const base = baseRuntime();
    base.stats.refusedConnectors = ['Chatarmin'];
    const rt = withConnectorPool(base, pool);
    expect(await rt.execute(USE_CONNECTOR_TOOL, { service: 'Gmail' })).toMatch(/cannot be used/);
    expect(pool.active).toEqual([]);
  });
});

describe('a persona fetches its services', () => {
  const chatarmin = 'https://chatarmin.example.com/mcp';
  const list = [avail('shared', 'Chatarmin', null, chatarmin), avail('mine', 'Chatarmin', ME, chatarmin), avail('g', 'Gmail')];
  const key = connectorServiceKey({ provider: 'mcp', name: 'Chatarmin', mcp_url: chatarmin });

  it('the person\'s own connection before the shared one, and missing services are named', async () => {
    const pool = new ConnectorPool<C>(list, [], { resolve: async ids => resolved(ids, list) });
    const text = await pool.fetchForPersona([{ key, name: 'Chatarmin' }, { key: 'app:google:calendar', name: 'Google Calendar' }], ME);
    expect(pool.activeIds()).toEqual(['mine']);
    expect(text).toMatch(/available for this chat: Chatarmin/);
    expect(text).toMatch(/Not connected by this user: Google Calendar/);
  });
  it('get_persona hands the services to Chat and adds what came back; a failure costs nothing', async () => {
    const reader: any = { getPersona: async () => ({ text: '---\npersona: Analyst\n---', routeCount: 0, connectors: [{ key, name: 'Chatarmin' }] }) };
    const onPersonaLoaded = vi.fn(async () => '\n\n## Connectors\n\nok');
    const rt = createLibraryToolRuntime(async () => reader, { onPersonaLoaded });
    expect(await rt.execute('get_persona', { name: 'analyst' })).toBe('---\npersona: Analyst\n---\n\n## Connectors\n\nok');
    expect(onPersonaLoaded).toHaveBeenCalledWith([{ key, name: 'Chatarmin' }]);

    const broken = createLibraryToolRuntime(async () => reader, { onPersonaLoaded: async () => { throw new Error('db down'); } });
    expect(await broken.execute('get_persona', { name: 'analyst' })).toBe('---\npersona: Analyst\n---');
  });
});

describe('wiring in chat-message', () => {
  const fn = code(read('supabase/functions/chat-message/index.ts'));

  it('⛔ the list of available connectors reads no credential', () => {
    const list = /async function listAvailableConnectors[\s\S]*?\n\}/.exec(fn)![0];
    expect(list).toMatch(/\.select\('id, name, mcp_url, provider, user_id, created_at'\)/);
    expect(list).not.toMatch(/token|encrypted|secret/);
    expect(list).toMatch(/r\.user_id === null \|\| r\.user_id === userId/);
  });
  it('the pool wraps the runtime after the continuation is restored', () => {
    expect(fn.indexOf('withConnectorPool(runtime, pool')).toBeGreaterThan(fn.indexOf('restoreToolRuntime(runtime, continuation.tools)'));
  });
  it('a hand-over carries the fetched connectors in the signed request, and their tokens count as secrets', () => {
    expect(fn).toMatch(/request: pool \? \{ \.\.\.request, connectorIds: pool\.activeIds\(\) \} : request,/);
    expect(fn).toMatch(/fetchedConnectors: pool\?\.fetchedNames \?\? \[\]/);
    expect(fn).toMatch(/\.\.\.\(pool\?\.active \?\? connectors \?\? \[\]\)\.map\(c => c\.token\)/);
  });
  it('the result carries the ids for the session and the answer says what was fetched', () => {
    expect(fn).toMatch(/\.\.\.\(pool\?\.fetchedNames\.length \? \{ connectorIds: pool\.activeIds\(\) \} : \{\}\)/);
    expect(fn).toMatch(/result \+= connectorsFetchedNotice\(pool\.fetchedNames, locale\)/);
  });
  it('use_connector exists in Chat only — the MCP server does not know it', () => {
    expect(read('supabase/functions/mcp-server/index.ts')).not.toMatch(/use_connector|connectorPool/);
  });
});

describe('SQEM-652 — no provider runs a connector itself any more', () => {
  const fn = code(read('supabase/functions/chat-message/index.ts'));
  it('Claude gets no mcp_servers and OpenAI no tools[type:mcp]; both get the runtime with the connector functions', () => {
    expect(fn).not.toMatch(/mcp_servers/);
    expect(fn).not.toMatch(/mcp_toolset/);
    expect(fn).not.toMatch(/type: 'mcp'/);
    expect(fn).not.toMatch(/anthropic-beta/);
    expect(fn).not.toMatch(/CHAT_CONNECTORS_VIA_SQEMES|nativeMcp|withFetched|resumedConnectors/);
    expect(fn).toMatch(/callOpenAIResponses\(apiKey, modelId, instruction, messages, onDelta, runtime, cancel\.signal, locale, resume\)/);
    expect(fn).toMatch(/callClaude\(apiKey, modelId, instruction, messages, onDelta, runtime, cancel\.signal, locale, resume, \{ stable: stableInstruction, changing: changingInstruction \}\)/);
  });
  it('the connectors are listed for every provider, Claude and OpenAI included', () => {
    expect(fn).toMatch(/if \(base && connectors\?\.length\) \{\s*const loaded = await loadConnectorTools/);
    expect(fn).toMatch(/load: \(cs, offset\) => loadConnectorTools/);
  });
});
