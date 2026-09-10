import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-372 — the wiring, and above all the three cases that must NOT stream.
 *
 * The transport itself is covered by `sseStream.test.ts`. What is asserted here is where streaming
 * is switched on and off, because every one of those decisions protects something that would fail
 * silently.
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const code = (src: string) => src
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const CHAT_FN = code(readFileSync(root('supabase/functions/chat-message/index.ts'), 'utf8'));
const JOB = code(readFileSync(root('lib/realtimeJob.ts'), 'utf8'));
const CHAT_PAGE = code(readFileSync(root('pages/Chat.tsx'), 'utf8'));

describe('SQEM-372 — what must not stream', () => {
  it('⛔ funded calls do not stream — credits are metered from usage', () => {
    // `FUNDED_MODEL` is `mistral-small-latest`, so every credit-metered chat runs through
    // `callOpenAICompatible`, and `debitCredits` is fed from `usage.total_tokens`. A streamed reply
    // reports zero tokens unless the provider honours `stream_options` — and a silent under-charge
    // is invisible in a way an over-charge never is.
    expect(CHAT_FN).toMatch(/const streams = !funded/);
  });

  it('⛔ connector calls do not stream — tool events interleave with text', () => {
    expect(CHAT_FN).toMatch(/const streams = !funded && !connectors\?\.length/);
  });

  it('image models do not stream', () => {
    // One response with inline data; there is nothing to show progressively.
    expect(CHAT_FN).toMatch(/const streaming = !!onDelta && !isImageModel/);
  });

  it('the OpenAI-compatible path asks for usage on the stream', () => {
    // Without `include_usage` a streamed reply reports zero tokens, which reads exactly like a free
    // request. Requested even though funded does not stream yet — so that lifting that restriction
    // is a one-line change and not a re-discovery.
    expect(CHAT_FN).toMatch(/stream_options: \{ include_usage: true \}/);
  });
});

describe('SQEM-372 — ordering, where the one real race lives', () => {
  it('⛔ the broadcaster is flushed BEFORE the terminal result', () => {
    // A delta arriving after the result would overwrite the finished answer with an earlier,
    // shorter version of itself. Order is the whole guard.
    const flush = CHAT_FN.indexOf('broadcaster?.flush()');
    const result = CHAT_FN.indexOf("broadcastJobResult(jobId, { result })");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(result);
  });

  it('⚠️ the error path does NOT flush', () => {
    // A partial answer followed by an error reads as if the fragment were the reply.
    const errIdx = CHAT_FN.indexOf('error: err?.message');
    const tail = CHAT_FN.slice(errIdx);
    expect(tail).not.toMatch(/flush\(\)/);
  });

  it('the broadcaster is created once per message, not per provider call', () => {
    // ⭐ The shape SQEM-373 needs: a later tool loop calls a provider several times and must keep
    // one continuous stream. Creating it per call would have had to be undone.
    expect([...CHAT_FN.matchAll(/createDeltaBroadcaster\(/g)]).toHaveLength(1);
  });
});

describe('SQEM-372 — the client', () => {
  it('listens for delta as well as result', () => {
    expect(JOB).toMatch(/event: 'delta'/);
    expect(JOB).toMatch(/event: 'result'/);
  });

  it('⛔ a delta does not refresh the timeout', () => {
    // A stream that starts and then stalls must still time out. Refreshing on every delta would let
    // a wedged provider hold the UI open forever — worse than a timeout, because nothing reports it.
    const deltaHandler = JOB.slice(JOB.indexOf("event: 'delta'"), JOB.indexOf("event: 'result'"));
    expect(deltaHandler).not.toMatch(/clearTimeout|setTimeout/);
  });

  it('⛔ Chat REPLACES the message content, never appends', () => {
    // Deltas are cumulative precisely so a dropped one self-heals. Appending would double the text
    // on every message — the failure mode of assuming increments.
    const handler = CHAT_PAGE.slice(CHAT_PAGE.indexOf('waitForJobResult(jobId, controller.signal'));
    const body = handler.slice(0, handler.indexOf('});'));
    expect(body).toMatch(/content: textSoFar/);
    expect(body).not.toMatch(/content: m\.content \+/);
  });

  it('the thinking bubble clears on the first delta', () => {
    // Leaving `pending` set would render a spinner above the reply it announced.
    const handler = CHAT_PAGE.slice(CHAT_PAGE.indexOf('waitForJobResult(jobId, controller.signal'));
    expect(handler.slice(0, handler.indexOf('});'))).toMatch(/pending: false/);
  });
});
