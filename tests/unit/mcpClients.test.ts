import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MCP_CLIENTS, MCP_KEY_ENV } from '../../lib/mcpClients';

/**
 * SQEM-533 — the per-client MCP setup. One source (lib/mcpClients.ts) for the Settings card and the
 * setup wizard; every entry points at the client's own documentation and says when it was checked.
 */
const URL = 'https://api.example.test/functions/v1/mcp-server';

describe('SQEM-533 — MCP_CLIENTS', () => {
  it('covers the clients the ticket names, plus a generic fallback', () => {
    expect(MCP_CLIENTS.map(c => c.id)).toEqual(['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'vscode', 'other']);
  });

  it('every entry links to official documentation and carries a check date', () => {
    for (const c of MCP_CLIENTS) {
      expect(c.docsUrl, c.id).toMatch(/^https:\/\//);
      expect(c.checkedOn, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.steps.length, c.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('every snippet carries the real endpoint — nothing hard-codes a URL', () => {
    for (const c of MCP_CLIENTS) {
      const s = c.snippet?.(URL);
      if (!s) continue;
      expect(s.code, c.id).toContain(URL);
      expect(s.code, c.id).not.toMatch(/https:\/\/(api\.sqemes\.com|[a-z]{20}\.supabase\.co)/);
    }
  });

  it('⛔ no snippet that a person saves in a project carries a key — env var or password prompt instead', () => {
    for (const c of MCP_CLIENTS.filter(c => c.auth === 'key' && c.id !== 'other')) {
      const code = c.snippet!(URL).code;
      expect(code, c.id).not.toMatch(/sqm_live_/);
      expect(code, c.id).toMatch(new RegExp(`\\$\\{env:${MCP_KEY_ENV}\\}|\\$\\{input:`));
    }
  });

  it('the JSON snippets are valid JSON once filled in', () => {
    for (const id of ['cursor', 'vscode', 'other'] as const) {
      const code = MCP_CLIENTS.find(c => c.id === id)!.snippet!(URL).code;
      expect(() => JSON.parse(code), id).not.toThrow();
    }
  });

  it('the old single snippet labelled "Claude Desktop / Cursor" is gone from Settings', () => {
    const settings = readFileSync('pages/Settings.tsx', 'utf8');
    expect(settings).not.toContain('Client Config (Claude Desktop / Cursor)');
    expect(settings).toContain('<McpClientGuide url={mcpUrl} />');
  });
});
