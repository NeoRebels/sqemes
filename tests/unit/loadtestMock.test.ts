import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isLoadtestRequest, runLoadtestMock, LOADTEST_MODEL } from '../../supabase/functions/_shared/loadtestMock';

/**
 * SQEM-500 — the simulated chat provider must say no in every case but one. It exists for load tests
 * on staging; on production and on self-host the environment variable is absent, and then the mock
 * must be unreachable whatever the request says.
 */
const SECRET = 'x'.repeat(40);

describe('isLoadtestRequest — every way it must refuse', () => {
  it('⛔ no environment secret (production, self-host) → never, even with a matching header', () => {
    expect(isLoadtestRequest(LOADTEST_MODEL, SECRET, undefined)).toBe(false);
    expect(isLoadtestRequest(LOADTEST_MODEL, '', '')).toBe(false);
    expect(isLoadtestRequest(LOADTEST_MODEL, null, null)).toBe(false);
  });
  it('⛔ a short secret does not count as set', () => {
    expect(isLoadtestRequest(LOADTEST_MODEL, 'short', 'short')).toBe(false);
  });
  it('⛔ wrong, missing or longer header → no', () => {
    expect(isLoadtestRequest(LOADTEST_MODEL, 'y'.repeat(40), SECRET)).toBe(false);
    expect(isLoadtestRequest(LOADTEST_MODEL, null, SECRET)).toBe(false);
    expect(isLoadtestRequest(LOADTEST_MODEL, SECRET + 'x', SECRET)).toBe(false);
  });
  it('⛔ any other model id → no, even with the right secret', () => {
    expect(isLoadtestRequest('gpt-4o-mini', SECRET, SECRET)).toBe(false);
    expect(isLoadtestRequest(undefined, SECRET, SECRET)).toBe(false);
  });
  it('the one yes: the model id, the env secret, and the same secret in the header', () => {
    expect(isLoadtestRequest(LOADTEST_MODEL, SECRET, SECRET)).toBe(true);
  });
});

describe('runLoadtestMock', () => {
  it('consults the library like a model would, then streams', async () => {
    const calls: string[] = [];
    const tools = { execute: async (name: string) => { calls.push(name); return name === 'search_templates' ? '[{"name":"diagram_design"}]' : '{}'; } };
    const deltas: string[] = [];
    const out = await runLoadtestMock(d => deltas.push(d), tools, { tokens: 5, delayMs: 0, sleep: async () => {} });
    expect(calls).toEqual(['search_templates', 'get_template']);
    expect(deltas).toHaveLength(5);
    expect(out).toContain('diagram_design');
  });
});

describe('chat-message wiring', () => {
  const src = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
  it('⛔ routes to the mock only through isLoadtestRequest with the env secret', () => {
    expect(src).toMatch(/isLoadtestRequest\(\s*modelId,\s*req\.headers\.get\(LOADTEST_HEADER\),\s*Deno\.env\.get\('CHAT_LOADTEST_SECRET'\)\s*\)/);
    // The provider id 'loadtest' is assigned in exactly one place.
    expect(src.match(/provider = 'loadtest'/g)?.length).toBe(1);
  });
});
