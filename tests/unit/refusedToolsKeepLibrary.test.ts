import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sanitizeSchema } from '../../supabase/functions/_shared/mcpClient';
import { afterToolsRefused, toolsRefusedNotice, type ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { en, de } from './i18nText';

/**
 * SQEM-638 — A customer, 2026-11-03, 10:53–11:08 UTC: Gemini refused the whole tool list five times over
 * one empty enum value in a connector's schema, and every answer came without the library, without the
 * connectors and without a word saying so.
 */
const def = (name: string, description = name) => ({ name, description, parameters: { type: 'object' as const, properties: {} } });
const runtime = (names: [string, string?][]): ToolRuntime => ({
  definitions: names.map(([n, d]) => def(n, d)),
  maxRounds: 6,
  deadline: Date.now() + 60_000,
  execute: async () => '',
  stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [], stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0 },
});

describe('SQEM-638 — an empty enum value never reaches a provider', () => {
  it('drops empty values, and the enum itself when nothing is left', () => {
    const out = sanitizeSchema({
      type: 'object',
      properties: {
        text_decoration: { type: 'string', enum: ['', 'underline', 'line-through'] },
        empty: { type: 'string', enum: [''] },
      },
    }) as any;
    expect(out.properties.text_decoration.enum).toEqual(['underline', 'line-through']);
    expect(out.properties.empty).toEqual({ type: 'string' });
  });
});

describe('SQEM-638 — a refused tool list costs the connectors first, the library last', () => {
  it('first retry keeps the library and names the connectors that went', () => {
    const tools = runtime([['search_templates'], ['mcp0__list_orders', '[Shopify] List orders'], ['mcp1__get_org', '[Chatarmin] Org'], ['mcp1__list_flows', '[Chatarmin] Flows']]);
    const next = afterToolsRefused(tools);
    expect(next?.definitions.map(d => d.name)).toEqual(['search_templates']);
    expect(next?.stats).toBe(tools.stats); // one stats object, so the log line counts both attempts
    expect(tools.stats.refusedConnectors).toEqual(['Shopify', 'Chatarmin']);
    expect(tools.stats.toolsRefused).toBe(false);
  });

  it('⛔ second refusal drops everything and ends — it cannot loop', () => {
    const tools = runtime([['search_templates'], ['mcp0__list_orders', '[Shopify] List orders']]);
    const second = afterToolsRefused(afterToolsRefused(tools)!);
    expect(second).toBeNull();
    expect(tools.stats.toolsRefused).toBe(true);
  });

  it('without connector tools (Claude, OpenAI: connectors run at the provider) it is the old behaviour', () => {
    const tools = runtime([['search_templates'], ['get_template']]);
    expect(afterToolsRefused(tools)).toBeNull();
    expect(tools.stats.toolsRefused).toBe(true);
    expect(tools.stats.refusedConnectors).toEqual([]);
  });

  it('only connector tools: nothing would be left, so it drops everything at once', () => {
    const tools = runtime([['mcp0__list_orders', '[Shopify] List orders']]);
    expect(afterToolsRefused(tools)).toBeNull();
    expect(tools.stats.toolsRefused).toBe(true);
  });
});

describe('SQEM-638 — the loss is said under the answer', () => {
  it('names the connectors, or says the library went too; nothing when nothing was lost', () => {
    const tools = runtime([]);
    expect(toolsRefusedNotice(tools.stats)).toBe('');
    tools.stats.refusedConnectors = ['Shopify', 'Chatarmin'];
    expect(toolsRefusedNotice(tools.stats)).toContain('Shopify, Chatarmin');
    expect(toolsRefusedNotice(tools.stats, 'de')).toContain('Ohne die Connectors Shopify, Chatarmin');
    tools.stats.toolsRefused = true;
    expect(toolsRefusedNotice(tools.stats)).toContain('library');
  });

  it('both texts exist in both languages', () => {
    for (const k of ['chat_tools_refused_connectors', 'chat_tools_refused_all'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
      expect(de[k]).not.toBe(en[k]);
    }
  });

  it('chat-message adds the notice and logs a connectors-only refusal too', () => {
    const fn = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect(fn).toMatch(/result \+= toolsRefusedNotice\(tools\.stats, locale\)/);
    expect(fn).toMatch(/tools\.stats\.refusedConnectors\.length > 0/);
    expect(fn).toMatch(/errText\.slice\(0, 2000\)/);
    expect(fn).not.toMatch(/errText\.slice\(0, 300\)/);
  });
});
