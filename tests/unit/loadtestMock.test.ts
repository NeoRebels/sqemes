import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isLoadtestRequest, runLoadtestMock, loadtestSeconds, loadtestQuiet, loadtestNoBeat, LOADTEST_MODEL } from '../../supabase/functions/_shared/loadtestMock';

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

describe('SQEM-673 — a timed run, for routine load tests', () => {
  it('the suffix gives seconds, capped at 300; anything else is no timed model', () => {
    expect(loadtestSeconds('sqemes-loadtest-mock:120')).toBe(120);
    expect(loadtestSeconds('sqemes-loadtest-mock:999')).toBe(300);
    expect(loadtestSeconds('sqemes-loadtest-mock')).toBeNull();
    expect(loadtestSeconds('sqemes-loadtest-mock:')).toBeNull();
    expect(loadtestSeconds('sqemes-loadtest-mock:12a')).toBeNull();
    expect(loadtestSeconds('gpt-4o-mini:30')).toBeNull();
    expect(loadtestSeconds(undefined)).toBeNull();
  });
  it('⛔ a timed model id is refused exactly like the plain one without the env secret or header', () => {
    expect(isLoadtestRequest('sqemes-loadtest-mock:120', SECRET, undefined)).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120', null, SECRET)).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120', 'y'.repeat(40), SECRET)).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120', SECRET, SECRET)).toBe(true);
  });
  it('spreads its tokens over the requested seconds', async () => {
    const waits: number[] = [];
    await runLoadtestMock(undefined, null, { tokens: 10, seconds: 30, sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toHaveLength(10);
    expect(waits.every(w => w === 3000)).toBe(true);
  });
  it('chat-message passes the seconds from the model id', () => {
    const src = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect(src).toMatch(/runLoadtestMock\(loadtestQuiet\(modelId\) \? undefined : onDelta, tools, \{ seconds: loadtestSeconds\(modelId\) \}\)/);
  });
  it('a quiet timed run streams nothing; only the timed form can be quiet, and it stays behind the secret', () => {
    expect(loadtestQuiet('sqemes-loadtest-mock:120:quiet')).toBe(true);
    expect(loadtestSeconds('sqemes-loadtest-mock:120:quiet')).toBe(120);
    expect(loadtestQuiet('sqemes-loadtest-mock:120')).toBe(false);
    expect(loadtestQuiet('sqemes-loadtest-mock:quiet')).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120:quiet', SECRET, undefined)).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120:quiet', SECRET, SECRET)).toBe(true);
  });
});

describe('SQEM-676 — :nobeat for the heartbeat A/B measurement', () => {
  it('parses alone and after quiet/die, never on its own model or a real one', () => {
    expect(loadtestNoBeat('sqemes-loadtest-mock:120:quiet:nobeat')).toBe(true);
    expect(loadtestQuiet('sqemes-loadtest-mock:120:quiet:nobeat')).toBe(true);
    expect(loadtestSeconds('sqemes-loadtest-mock:120:quiet:nobeat')).toBe(120);
    expect(loadtestNoBeat('sqemes-loadtest-mock:120:nobeat')).toBe(true);
    expect(loadtestQuiet('sqemes-loadtest-mock:120:nobeat')).toBe(false);
    expect(loadtestNoBeat('sqemes-loadtest-mock:120:quiet')).toBe(false);
    expect(loadtestNoBeat('gpt-5:nobeat')).toBe(false);
    expect(isLoadtestRequest('sqemes-loadtest-mock:120:quiet:nobeat', SECRET, undefined)).toBe(false);
  });
});
