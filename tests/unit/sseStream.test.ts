import { describe, it, expect } from 'vitest';
import {
  readSSE, geminiDelta, openAiDelta, claudeDelta,
} from '../../supabase/functions/_shared/sseStream';
import { createDeltaBroadcaster } from '../../supabase/functions/_shared/deltaBroadcast';

/**
 * SQEM-372 — the streaming transport, and the two things that would silently corrupt an answer.
 *
 * ⚠️ Both modules are import-free on purpose so this file can exist at all; anything reaching
 * `lib/supabase` throws at import time without env vars.
 * See `docs/ai/modules/testing.md` in the source repository.
 */
function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

const collect = async (body: ReadableStream<Uint8Array>, extract: Parameters<typeof readSSE>[1]) => {
  const deltas: string[] = [];
  const res = await readSSE(body, extract, d => deltas.push(d));
  return { ...res, deltas };
};

describe('readSSE — transport', () => {
  it('assembles increments and reports each one', async () => {
    const { text, deltas } = await collect(stream(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ), openAiDelta);
    expect(text).toBe('Hello');
    expect(deltas).toEqual(['Hel', 'lo']);
  });

  it('⛔ survives a data line split across two network reads', async () => {
    // The defect that would produce a hole in the middle of a sentence with no error anywhere.
    // A chunk boundary does not respect line boundaries; the tail has to be carried over.
    const { text, deltas } = await collect(stream(
      'data: {"choices":[{"delta":{"con',
      'tent":"whole"}}]}\n\n',
    ), openAiDelta);
    expect(text).toBe('whole');
    expect(deltas).toEqual(['whole']);
  });

  it('ignores keep-alives, event lines and blank lines', async () => {
    const { text, skipped } = await collect(stream(
      ': keep-alive\n\n',
      'event: content_block_delta\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      '\n',
    ), openAiDelta);
    expect(text).toBe('x');
    expect(skipped).toBe(0);
  });

  it('counts an unparseable chunk instead of losing the answer', async () => {
    // ⚠️ Not thrown: one bad chunk must not cost a reply that is otherwise complete. Not silent
    // either — a provider changing its format should be visible.
    const { text, skipped } = await collect(stream(
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {not json\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
    ), openAiDelta);
    expect(text).toBe('ab');
    expect(skipped).toBe(1);
  });

  it('handles an empty body', async () => {
    const res = await readSSE(null, openAiDelta, () => {});
    expect(res).toEqual({ text: '', skipped: 0 });
  });
});

describe('readSSE — the per-provider extractors', () => {
  it('Gemini joins the parts of a candidate', async () => {
    const { text } = await collect(stream(
      'data: {"candidates":[{"content":{"parts":[{"text":"A"},{"text":"B"}]}}]}\n\n',
    ), geminiDelta);
    expect(text).toBe('AB');
  });

  it('⛔ Claude takes text ONLY from content_block_delta', async () => {
    // Every other event rides the same stream. An extractor that reached for `.text` wherever it
    // found one would splice stray fragments into the reply.
    const { text, deltas } = await collect(stream(
      'data: {"type":"message_start","message":{"content":[]}}\n\n',
      'data: {"type":"content_block_start","content_block":{"type":"text","text":"IGNORE"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"real"}}\n\n',
      'data: {"type":"ping"}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    ), claudeDelta);
    expect(text).toBe('real');
    expect(deltas).toEqual(['real']);
  });

  it('every extractor returns null for a shape it does not know', async () => {
    for (const extract of [geminiDelta, openAiDelta, claudeDelta]) {
      expect(extract({})).toBeNull();
      expect(extract(null)).toBeNull();
      expect(extract({ unexpected: true })).toBeNull();
    }
  });
});

describe('createDeltaBroadcaster', () => {
  const harness = () => {
    const sent: string[] = [];
    let clock = 0;
    const b = createDeltaBroadcaster(
      async (t) => { sent.push(t); },
      { intervalMs: 100, now: () => clock },
    );
    return { sent, b, tick: (ms: number) => { clock += ms; } };
  };

  it('⛔ batches by time — not one message per token', async () => {
    const { sent, b, tick } = harness();
    for (const t of ['a', 'b', 'c', 'd']) b.push(t); // same instant
    await b.flush();
    // One dispatch at the first push (clock 0 ≥ interval), then the flush carries the rest.
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(sent[sent.length - 1]).toBe('abcd');
    tick(0);
  });

  it('⭐ the FIRST increment goes out immediately', async () => {
    // The entire perceived-speed win is the gap between "sent" and "something appears". Waiting one
    // interval for the first token would give most of it away.
    //
    // ⚠️ This originally worked by accident: `now() - 0` is ~1.7e12 with a real clock, so the first
    // push exceeded any interval. A fake clock starting at 0 showed the behaviour rested on the
    // clock's absolute value rather than on intent.
    // ⚠️ "Immediately" means WITHOUT waiting for the interval, not synchronously: `dispatch` chains
    // onto the in-flight promise so the read loop is never blocked by a broadcast. The clock does
    // not advance here, so a single send proves the interval was not waited for.
    const { sent, b } = harness();
    b.push('a');
    await b.flush(); // awaits the already-dispatched send; adds nothing, since nothing is pending
    expect(sent).toEqual(['a']);
  });

  it('sends again once the interval has passed', async () => {
    const { sent, b, tick } = harness();
    b.push('a');
    tick(150);
    b.push('b');
    await b.flush();
    expect(sent).toContain('a');
    expect(sent[sent.length - 1]).toBe('ab');
  });

  it('⛔ every payload is cumulative, so a dropped message self-heals', async () => {
    // Realtime broadcast is best-effort. With increments, one drop leaves a permanent hole; with
    // cumulative payloads the next message that arrives repairs it.
    const { sent, b, tick } = harness();
    b.push('one ');
    tick(150);
    b.push('two ');
    tick(150);
    b.push('three');
    await b.flush();
    for (let i = 1; i < sent.length; i += 1) {
      expect(sent[i].startsWith(sent[i - 1])).toBe(true);
    }
    expect(sent[sent.length - 1]).toBe('one two three');
  });

  it('flush does not repeat an unchanged buffer', async () => {
    const { sent, b } = harness();
    b.push('x');
    await b.flush();
    const afterFirst = sent.length;
    await b.flush();
    expect(sent.length).toBe(afterFirst);
  });

  it('a failing send never breaks the read loop', async () => {
    // Losing a delta costs a stutter; the terminal `result` still carries the whole answer.
    const b = createDeltaBroadcaster(async () => { throw new Error('realtime down'); });
    b.push('a');
    await expect(b.flush()).resolves.toBeUndefined();
    expect(b.text()).toBe('a');
  });

  it('ignores empty increments', async () => {
    const { sent, b } = harness();
    b.push('');
    await b.flush();
    expect(sent).toEqual([]);
  });
});
