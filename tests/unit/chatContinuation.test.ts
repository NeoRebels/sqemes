import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHAT_CHAIN_MS, MAX_GENERATIONS, STATE_TTL_MS, ChatContinuation, splitTokens, canContinue, invocationDeadline, containsSecret,
  signContinuation, openContinuation, type ContinuationState,
} from '../../supabase/functions/_shared/chatContinuation';
import { advanceToolRound, restoreToolRuntime, createLibraryToolRuntime, type ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { createClaudeBlockCollector, isPauseTurn, MAX_PAUSE_RESUMES } from '../../supabase/functions/_shared/claudePause';
import { createDeltaBroadcaster } from '../../supabase/functions/_shared/deltaBroadcast';
import { jobEventFor } from '../../supabase/functions/_shared/jobEvents';
import { clientChainCapMs, clientHardCapMs, providerTimeoutMs } from '../../supabase/functions/_shared/chatTimeouts';

/**
 * SQEM-649 — one answer across several invocations of `chat-message`.
 * The pure parts are driven here; the wiring inside `chat-message` (Deno, not importable) is pinned by
 * source assertions at the end.
 */

const SECRET = 'service-role-key-for-tests';
const USER = 'user-1';
const T0 = 1_800_000_000_000;

function state(over: Partial<ContinuationState> = {}): ContinuationState {
  return {
    v: 1, jobId: 'job-1', userId: USER, workspaceId: 'ws-1', chainStartedAt: T0, gen: 2,
    request: { modelId: 'gpt-6', funded: false, systemInstruction: 'Be brief.', connectorIds: ['c1'], locale: 'de' },
    provider: 'openai',
    loop: { convo: [{ role: 'user', content: 'Alles' }, { type: 'function_call_output', call_id: 'x', output: 'mail…' }], answer: 'Teil 1. ', activeConnectorNames: ['c_1'], droppedConnectors: [] },
    tools: { stats: { rounds: 3, calls: 5, byTool: { get_persona: 1 }, libraryRounds: 1, nativeConnectorCalls: 2, continuations: 1 } },
    collected: { loadedTemplateIds: ['t1'], libraryChanges: [], webSources: { queries: [], pages: [] }, webAllowanceExhausted: false, generatedFiles: [], unreachable: [] },
    ...over,
  };
}

const runtime = (over: Partial<ToolRuntime> = {}): ToolRuntime => ({
  ...createLibraryToolRuntime(async () => { throw new Error('no reader'); }, { maxRounds: 6, budgetMs: 90_000, now: () => T0 }),
  ...over,
});

describe('the signed state', () => {
  it('goes there and back unchanged', async () => {
    const s = state();
    const opened = await openContinuation(await signContinuation(s, SECRET), SECRET, USER, T0 + 100_000);
    expect(opened).toEqual({ ok: true, state: s });
  });

  it('⛔ a changed state is refused — the round counters cannot be forged', async () => {
    const signed = await signContinuation(state(), SECRET);
    const forged = { ...signed, state: signed.state.replace('"rounds":3', '"rounds":0') };
    expect(await openContinuation(forged, SECRET, USER, T0)).toEqual({ ok: false, reason: 'signature' });
  });

  it('⛔ another person cannot carry it on, nor anybody with another key', async () => {
    const signed = await signContinuation(state(), SECRET);
    expect(await openContinuation(signed, SECRET, 'user-2', T0)).toEqual({ ok: false, reason: 'user' });
    expect(await openContinuation(signed, 'other-key', USER, T0)).toEqual({ ok: false, reason: 'signature' });
    expect(await openContinuation(signed, '', USER, T0)).toMatchObject({ ok: false });
  });

  it('expires, and a chain cannot grow without bound', async () => {
    const signed = await signContinuation(state(), SECRET);
    expect(await openContinuation(signed, SECRET, USER, T0 + STATE_TTL_MS)).toEqual({ ok: false, reason: 'expired' });
    const long = await signContinuation(state({ gen: MAX_GENERATIONS + 1 }), SECRET);
    expect(await openContinuation(long, SECRET, USER, T0)).toEqual({ ok: false, reason: 'generation' });
    const first = await signContinuation(state({ gen: 1 }), SECRET);
    expect(await openContinuation(first, SECRET, USER, T0)).toEqual({ ok: false, reason: 'generation' });
  });

  it('a malformed envelope is refused, not repaired', async () => {
    expect(await openContinuation(null, SECRET, USER, T0)).toEqual({ ok: false, reason: 'malformed' });
    expect(await openContinuation({ state: 1, sig: 'x' }, SECRET, USER, T0)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('⛔ a secret in it is found — the runtime check before any hand-over', () => {
    const serialized = JSON.stringify(state());
    expect(containsSecret(serialized, ['sk-live-abcdef123456', null, undefined])).toBe(false);
    expect(containsSecret(serialized + 'sk-live-abcdef123456', ['sk-live-abcdef123456'])).toBe(true);
    // A short or empty "secret" would match anything; it is ignored rather than blocking every hand-over.
    expect(containsSecret(serialized, ['', 'de'])).toBe(false);
  });
});

describe('the clock', () => {
  it('the chain may go on for 10 minutes from the message, and no further', () => {
    expect(CHAT_CHAIN_MS).toBe(600_000); // decided 2026-11-04
    expect(canContinue(T0, 2, T0 + CHAT_CHAIN_MS - 1)).toBe(true);
    expect(canContinue(T0, 2, T0 + CHAT_CHAIN_MS)).toBe(false);
    expect(canContinue(T0, MAX_GENERATIONS, T0)).toBe(false);
  });

  it('one invocation never runs past the chain', () => {
    expect(invocationDeadline(T0, T0, 90_000)).toBe(T0 + 90_000);
    expect(invocationDeadline(T0 + 550_000, T0, 90_000)).toBe(T0 + CHAT_CHAIN_MS);
  });

  it('the browser waits for the chain plus one answer, longer than before a hand-over', () => {
    const cloud = { selfHosted: false };
    expect(clientChainCapMs(cloud)).toBeGreaterThan(CHAT_CHAIN_MS + providerTimeoutMs(cloud));
    expect(clientChainCapMs(cloud)).toBeGreaterThan(clientHardCapMs(cloud));
  });
});

describe('advanceToolRound — hand over instead of stopping', () => {
  it('past the deadline, with chain time left: hand-over, no cap', () => {
    const rt = runtime({ mayContinue: () => true });
    const next = advanceToolRound(rt, ['nifty__list'], () => T0 + 91_000)!;
    expect(next.handoff).toBe(true);
    expect(next.final).toBeFalsy();
    expect(rt.stats.cappedAt).toBeNull();
    expect(rt.stats.continuations).toBe(1);
  });

  it('past the deadline, chain over: the time cap as before', () => {
    const rt = runtime({ mayContinue: () => false });
    const next = advanceToolRound(rt, ['nifty__list'], () => T0 + 91_000)!;
    expect(next.handoff).toBeFalsy();
    expect(next.final).toBe(true);
    expect(rt.stats.cappedBy).toBe('time');
  });

  it('without `mayContinue` nothing changes (every caller before 649)', () => {
    const next = advanceToolRound(runtime(), ['x'], () => T0 + 91_000)!;
    expect(next.final).toBe(true);
    expect(next.handoff).toBeFalsy();
  });
});

describe('restoreToolRuntime — the next invocation counts the whole answer', () => {
  it('brings the counters back', () => {
    const rt = restoreToolRuntime(runtime(), state().tools! as any)!;
    expect(rt.stats.rounds).toBe(3);
    expect(rt.stats.libraryRounds).toBe(1);
    expect(rt.nativeCallsSeen).toBe(2);
  });

  it('a refusal stays a refusal', () => {
    expect(restoreToolRuntime(runtime(), { stats: { toolsRefused: true } })).toBeNull();
    const withConnector = runtime();
    withConnector.definitions = [...withConnector.definitions, { name: 'mcp1__list', description: '[Nifty] list', parameters: { type: 'object', properties: {} } }];
    const rt = restoreToolRuntime(withConnector, { stats: { refusedConnectors: ['Nifty'] } })!;
    expect(rt.definitions.some(d => d.name === 'mcp1__list')).toBe(false);
    expect(rt.definitions.length).toBeGreaterThan(0);
  });

  it('the fallback after a failed hand-over is the last round, with the time notice', () => {
    const rt = restoreToolRuntime(runtime(), { stats: { rounds: 4 } }, { forceFinal: true })!;
    expect(rt.final).toBe(true);
    expect(rt.stats.cappedBy).toBe('time');
    expect(rt.stats.cappedAt).toBe(4);
  });
});

describe('Claude pause_turn', () => {
  it('the turn is rebuilt block for block from the stream', () => {
    const c = createClaudeBlockCollector();
    const chunks = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Ich schaue ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'nach.' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'mcp_tool_use', id: 'm1', name: 'list', server_name: 'c_1', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"x"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'content_block_start', index: 2, content_block: { type: 'mcp_tool_result', tool_use_id: 'm1', content: [{ type: 'text', text: 'ok' }] } },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn' } },
    ];
    chunks.forEach(ch => c.onChunk(ch));
    expect(c.blocks()).toEqual([
      { type: 'text', text: 'Ich schaue nach.' },
      { type: 'mcp_tool_use', id: 'm1', name: 'list', server_name: 'c_1', input: { q: 'x' } },
      { type: 'mcp_tool_result', tool_use_id: 'm1', content: [{ type: 'text', text: 'ok' }] },
    ]);
  });

  it('only pause_turn is a pause, and resumes are bounded', () => {
    expect(isPauseTurn('pause_turn')).toBe(true);
    expect(isPauseTurn('end_turn')).toBe(false);
    expect(isPauseTurn(null)).toBe(false);
    expect(MAX_PAUSE_RESUMES).toBeGreaterThan(0);
  });
});

describe('the stream and the browser', () => {
  it('a continued answer streams on from the text already shown', async () => {
    const sent: string[] = [];
    const b = createDeltaBroadcaster(async t => { sent.push(t); }, { initial: 'Teil 1. ', now: () => 0 });
    await b.flush();
    expect(sent).toEqual([]); // nothing new — no duplicate of what is already on screen
    b.push('Teil 2.');
    await b.flush();
    expect(sent.at(-1)).toBe('Teil 1. Teil 2.');
  });

  it('`continued` is its own event, not a result', () => {
    expect(jobEventFor({ continued: 2 })).toBe('continued');
  });
});

describe('wiring in chat-message', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');

  it('all four loops accept a resume and hand over after the round', () => {
    for (const fn of ['callGemini', 'callOpenAIResponses', 'callClaude', 'callOpenAICompatible']) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf('\nasync function', src.indexOf(`async function ${fn}(`) + 1));
      expect(body, fn).toMatch(/resume\?: LoopSnapshot/);
      expect(body, fn).toMatch(/answer = resume\?\.answer \?\? ''/);
      expect(body, fn).toMatch(/activeTools = advanceToolRound\(activeTools, toolCalls\.map\(c => c\.name\)\);\s*(\/\/[^\n]*\n\s*)?if \(activeTools\?\.handoff\)/);
    }
  });

  it('Claude resumes a paused turn with the turn exactly as it came', () => {
    expect(src).toMatch(/isPauseTurn\(stop\)[\s\S]{0,120}apiMessages\.push\(\{ role: 'assistant', content: turnBlocks \}\)/);
  });

  it('⛔ the state carries no secret: no key, no token, no login', () => {
    // SQEM-686 — one builder for the hand-over and the checkpoint.
    const block = src.slice(src.indexOf('const stateFor = (loop: LoopSnapshot'), src.indexOf('const stateSecrets = '));
    expect(block).toMatch(/v: 1, jobId, userId/);
    expect(block).not.toMatch(/apiKey|authHeader|\.token\b|access_token|authorization/i); // `tokenCarry` is a count
    expect(src).toMatch(/containsSecret\(signed\.state, secrets\)/);
    expect(src).toMatch(/const stateSecrets = \(\) => \[apiKey, authHeader\.replace/);
    expect(src).toMatch(/handOver\(state, stateSecrets\(\)\)/);
    expect(src).toMatch(/const state = stateFor\(err\.loop, carry\);/);
  });

  it('⛔ nothing goes into the database', () => {
    const helper = src.slice(src.indexOf('const handOver = async'), src.indexOf('  try {\n    let result: string;'));
    expect(helper).not.toMatch(/\.from\(|\.rpc\(|insert|upsert/);
  });

  it('credits are charged per invocation, before the hand-over ends it', () => {
    expect(src).toMatch(/throw new ChatContinuation\(\{ convo: apiMessages, answer \}, totalTokens\)/);
    expect(src).toMatch(/totalTokens \+= err\.totalTokens;[\s\S]{0,1400}if \(handed\) \{\s*if \(funded && workspaceId\) \{\s*try \{ await debitCredits\(createAdminClient\(\), workspaceId, charge,/);
    expect(src).toMatch(/let totalTokens = continuation\?\.tokenCarry \?\? 0;/);
  });

  it('⛔ a hand-over does not cost an extra credit: the remainder below a thousand rides along', () => {
    expect(splitTokens(2_350)).toEqual({ charge: 2_000, carry: 350 });
    expect(splitTokens(300)).toEqual({ charge: 0, carry: 300 });
    // 3 invocations × 300 tokens, charged at the end: one credit (ceil 900/1000), as without hand-overs.
  });

  it('a continuation takes everything from the signed state, and is not counted twice', () => {
    expect(src).toMatch(/const src: Record<string, any> = continuation\s*\? \{ \.\.\.continuation\.request, jobId: continuation\.jobId, workspaceId: continuation\.workspaceId \}\s*: body;/);
    expect(src).toMatch(/const budget = continuation \? \{ ok: true as const \} : await checkChatBudget/);
  });
});

describe('the exception is not an error', () => {
  it('carries the loop and the tokens', () => {
    const e = new ChatContinuation({ convo: [], answer: 'x' }, 42);
    expect(e).toBeInstanceOf(Error);
    expect(e.totalTokens).toBe(42);
    expect(e.loop.answer).toBe('x');
  });
});

// SQEM-656 — on self-host the router decides how long a worker lives and whether a hand-over gets a
// fresh one. Measured 2026-11-04 on edge-runtime v1.74.0: 60 s ended background work in under 40 s,
// and a self-call reused the running worker; 400 s plus `forceCreate` on `?handover=1` fixed both.
describe('SQEM-656 — self-host workers', () => {
  const router = readFileSync('selfhost/edge-main/index.ts', 'utf8');
  const chat = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
  it('a worker may run 400 s, like the Cloud wall clock', () => {
    expect(router).toMatch(/const workerTimeoutMs = 400 \* 1000/);
    expect(router).not.toMatch(/workerTimeoutMs = 1 \* 60 \* 1000/);
  });
  it('a hand-over asks for a fresh worker, and the router gives one', () => {
    // SQEM-676 — a routine run hands over to chat-routine (its own workers), everything else to chat-message.
    expect(chat).toMatch(/\/functions\/v1\/\$\{routine \? 'chat-routine' : 'chat-message'\}\?handover=1`/);
    expect(router).toMatch(/forceCreate: url\.searchParams\.get\('handover'\) === '1'/);
  });
});
