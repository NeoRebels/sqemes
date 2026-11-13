import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkpointParts, createCheckpointHolder, CHECKPOINT_PART_CHARS, MAX_CHECKPOINT_CHARS, MAX_RESUMES,
} from '../../supabase/functions/_shared/chatCheckpoint';
import { signContinuation, openContinuation, type ContinuationState } from '../../supabase/functions/_shared/chatContinuation';
import { endOfRound, runToolCall, MAX_TOOL_ROUNDS, type ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { JOB_EVENTS, jobEventFor } from '../../supabase/functions/_shared/jobEvents';

/**
 * SQEM-686 — an answer whose worker died goes on from its last finished round. The browser holds the
 * checkpoint (nothing is stored), and never resumes once a round's tools started after it.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const SECRET = 'test-service-role-key-0123456789';

const state = (over: Partial<ContinuationState> = {}): ContinuationState => ({
  v: 1, jobId: 'job-1', userId: 'user-1', workspaceId: 'ws-1', chainStartedAt: Date.now(), gen: 2, provider: 'openai',
  request: { funded: false, modelId: 'm' }, loop: { convo: [{ role: 'user', content: 'x'.repeat(150_000) }], answer: 'so far' },
  tools: null, collected: {
    loadedTemplateIds: [], libraryChanges: [], webSources: { queries: [], pages: [] }, webAllowanceExhausted: false,
    generatedFiles: [], unreachable: [],
  },
  ...over,
});

const runtime = (): ToolRuntime => ({
  definitions: [], maxRounds: MAX_TOOL_ROUNDS, deadline: Number.MAX_SAFE_INTEGER,
  execute: async (name) => `result of ${name}`,
  stats: {
    rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [],
    stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0,
  },
});

describe('the parts', () => {
  it('a signed state goes out in parts and comes back whole, and still opens', async () => {
    const signed = await signContinuation(state(), SECRET);
    const parts = checkpointParts(signed, 3)!;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.data.length <= CHECKPOINT_PART_CHARS && p.round === 3 && p.parts === parts.length)).toBe(true);
    const holder = createCheckpointHolder();
    for (const p of [...parts].reverse()) holder.add(p); // the order of arrival does not matter
    const back = holder.resumable()!;
    expect(back).toEqual(signed);
    const opened = await openContinuation(back, SECRET, 'user-1', Date.now());
    expect(opened.ok).toBe(true);
  });

  it('a state too large to send is not sent', () => {
    expect(checkpointParts({ state: 'x'.repeat(MAX_CHECKPOINT_CHARS), sig: 'ab' }, 1)).toBeNull();
  });
});

describe('the holder in the browser', () => {
  const parts = (round: number, text = `{"state":"r${round}","sig":"s"}`) =>
    [0, 1].map(part => ({ round, part, parts: 2, data: part ? text.slice(10) : text.slice(0, 10) }));

  it('only a complete checkpoint counts; until then the last complete one stays', () => {
    const h = createCheckpointHolder();
    expect(h.resumable()).toBeNull();
    h.add(parts(1)[0]);
    expect(h.resumable()).toBeNull();
    h.add(parts(1)[1]);
    expect(h.resumable()?.state).toBe('r1');
    h.add(parts(2)[0]); // round 2 half arrived
    expect(h.resumable()?.state).toBe('r1');
    h.add(parts(2)[1]);
    expect(h.resumable()?.state).toBe('r2');
  });

  it('an older round never replaces a newer one, and malformed parts are ignored', () => {
    const h = createCheckpointHolder();
    parts(3).forEach(p => h.add(p));
    parts(2).forEach(p => h.add(p));
    expect(h.resumable()?.state).toBe('r3');
    for (const bad of [null, {}, { round: 4, part: 2, parts: 2, data: 'x' }, { round: 4, part: 0, parts: 1, data: 5 }, { round: 4, part: 0, parts: 1, data: 'not json' }]) h.add(bad);
    expect(h.resumable()?.state).toBe('r3');
  });

  it('⛔ tools after the checkpoint: no resume until a checkpoint of that round arrives', () => {
    const h = createCheckpointHolder();
    parts(2).forEach(p => h.add(p));
    h.toolsRunning(2); // round 2's tools ran BEFORE its checkpoint: fine
    expect(h.resumable()?.state).toBe('r2');
    h.toolsRunning(3); // round 3's tools started
    expect(h.resumable()).toBeNull();
    h.toolsRunning(2); // a late heartbeat with an older number changes nothing
    expect(h.resumable()).toBeNull();
    h.add(parts(3)[0]); // a half checkpoint does not lift it
    expect(h.resumable()).toBeNull();
    h.add(parts(3)[1]);
    expect(h.resumable()?.state).toBe('r3');
  });
});

describe('the resume count', () => {
  it('is signed: a state with its count changed does not open', async () => {
    const signed = await signContinuation(state({ resumes: MAX_RESUMES }), SECRET);
    const forged = { ...signed, state: signed.state.replace(`"resumes":${MAX_RESUMES}`, '"resumes":0') };
    expect(forged.state).not.toBe(signed.state);
    expect((await openContinuation(forged, SECRET, 'user-1', Date.now())).ok).toBe(false);
    const ok = await openContinuation(signed, SECRET, 'user-1', Date.now());
    expect(ok.ok && ok.state.resumes).toBe(MAX_RESUMES);
  });

  it('two at most', () => expect(MAX_RESUMES).toBe(2));
});

describe('the runtime hooks', () => {
  it('tools are announced once per call that runs, with the round they belong to, before it runs', async () => {
    const rt = runtime();
    const order: string[] = [];
    rt.stats.rounds = 4;
    rt.onToolsStart = (round) => { order.push(`start ${round}`); };
    rt.execute = async (name) => { order.push(`run ${name}`); return 'ok'; };
    await runToolCall(rt, { name: 'mcp0__create_order', args: '{"id":1}' });
    expect(order).toEqual(['start 5', 'run mcp0__create_order']);
  });

  it('a call that is not run announces nothing', async () => {
    const rt = runtime();
    const start = vi.fn();
    rt.onToolsStart = start;
    await runToolCall(rt, { name: 'upload_file', args: '{"content":"cut off' });
    expect(start).not.toHaveBeenCalled();
  });

  it('endOfRound hands the round on only while the loop goes on in this worker, and never throws', async () => {
    const loop = { convo: [], answer: 'a' };
    const rt = runtime();
    rt.stats.rounds = 2;
    const seen = vi.fn();
    rt.onRoundEnd = seen;
    await endOfRound(rt, loop, 7);
    expect(seen).toHaveBeenCalledWith(loop, 7, 2);
    seen.mockClear();
    await endOfRound({ ...rt, final: true }, loop);
    await endOfRound({ ...rt, handoff: true }, loop);
    await endOfRound(null, loop);
    expect(seen).not.toHaveBeenCalled();
    rt.onRoundEnd = () => { throw new Error('broadcast down'); };
    await expect(endOfRound(rt, loop)).resolves.toBeUndefined();
  });
});

describe('the events', () => {
  it('a checkpoint part, the tools mark and a beat with the mark each go out under their own name', () => {
    expect(jobEventFor({ checkpoint: { round: 1 } })).toBe('checkpoint');
    expect(jobEventFor({ toolsRound: 3 })).toBe('tools');
    expect(jobEventFor({ alive: true, toolsRound: 3 })).toBe('alive');
    expect(JOB_EVENTS).toContain('checkpoint');
    expect(JOB_EVENTS).toContain('tools');
  });
});

describe('wiring', () => {
  const fn = read('supabase/functions/chat-message/index.ts');
  const client = read('lib/realtimeJob.ts');
  const chat = read('pages/Chat.tsx');

  it('all four loops checkpoint after the round, right after the hand-over check', () => {
    for (const name of ['callGemini', 'callOpenAIResponses', 'callClaude', 'callOpenAICompatible']) {
      const start = fn.indexOf(`async function ${name}(`);
      const body = fn.slice(start, fn.indexOf('\nasync function', start + 1));
      expect(body, name).toMatch(/throw new ChatContinuation\([^\n]*\n(\s*\}\n)?\s*await endOfRound\(activeTools, \{ convo: \w+, answer \}/);
    }
  });

  it('⛔ a routine sends no checkpoints, and the checkpoint writes nothing to the database', () => {
    expect(fn).toMatch(/if \(tools && !routine\) \{\s*tools\.onRoundEnd = /);
    const sender = fn.slice(fn.indexOf('sendCheckpoint = async'), fn.indexOf('result = await dispatch(base, runtime, continuation?.loop);'));
    expect(sender).toMatch(/containsSecret\(signed\.state, stateSecrets\(\)\)/);
    expect(sender).not.toMatch(/\.from\(|\.rpc\(|insert|upsert/);
  });

  it('credits: the checkpoint carries every token of this invocation, nothing charged twice', () => {
    expect(fn).toMatch(/signContinuation\(stateFor\(loop, totalTokens \+ loopTokens\)/);
    expect(fn).toMatch(/resumes: continuation\?\.resumes \?\? 0/);
  });

  it('a resume is the person\'s own, for this job, and refused at the limit; every one is logged', () => {
    expect(fn).toMatch(/const resume = !routineTicket && !body\.continuation && body\.resume \? body\.resume : null;/);
    expect(fn).toMatch(/resume && \(opened\.state\.resumes \?\? 0\) >= MAX_RESUMES \? 'resumes'/);
    expect(fn).toMatch(/resume && opened\.state\.jobId !== body\.jobId \? 'job'/);
    expect(fn).toMatch(/console\.log\('\[chat-resume\]'/);
    expect(fn).toMatch(/resumes: \(opened\.state\.resumes \?\? 0\) \+ 1 \} : opened\.state/);
  });

  it('the browser resumes on silence only from a resumable checkpoint, at most twice, then says it is lost', () => {
    expect(client).toMatch(/const envelope = onResume && resumes < MAX_RESUMES \? checkpoints\.resumable\(\) : null;\s*if \(!envelope\) return lost\(\);/);
    expect(client).toMatch(/if \(settled\) return;\s*if \(!ok\) return lost\(\);/);
    expect(client).toMatch(/event: 'checkpoint' \}[\s\S]{0,140}checkpoints\.add\(payload\?\.checkpoint\)/);
    expect(chat).toMatch(/body: JSON\.stringify\(\{ resume: checkpoint, jobId, locale: getLocale\(\) \}\)/);
  });
});
