/**
 * SQEM-372 — turning a token stream into something a Realtime channel can carry.
 *
 * ⛔ **Not one broadcast per token.** A model emitting 40 tokens a second would put 40 messages a
 * second on the channel per active chat; on self-host that is the operator's Realtime instance
 * paying for it. Increments are batched by **time**, not by count, so the rate is bounded no matter
 * how fast the provider is.
 *
 * ⛔ **Each broadcast carries the whole text so far, not the increment.** Realtime broadcast is
 * best-effort: a dropped message is simply gone. With increments, one drop leaves a permanent hole
 * in the middle of an answer and nothing reports it. Cumulative payloads mean any single message
 * that arrives repairs every drop before it — the client replaces rather than appends.
 *
 * ⚠️ It costs bandwidth that grows with the answer: ~50 messages for a 5,000-character reply,
 * averaging half its length. Accepted knowingly — a self-healing stream beats a small one, and the
 * final `result` broadcast is authoritative regardless.
 *
 * ⭐ The send function is INJECTED rather than imported. `broadcast.ts` reads `Deno.env` at module
 * load, which would make this untestable.
 * See `docs/ai/modules/testing.md` in the source repository.
 */

export interface DeltaBroadcaster {
  /** Add a text increment. May or may not send, depending on the interval. */
  push(increment: string): void;
  /** Send whatever is pending, immediately. Call before the terminal result. */
  flush(): Promise<void>;
  /** Everything pushed so far. */
  text(): string;
}

export interface DeltaBroadcasterOptions {
  /** Minimum gap between broadcasts. 100 ms reads as continuous typing without flooding. */
  intervalMs?: number;
  /** Injected clock, so tests do not wait in real time. */
  now?: () => number;
}

export function createDeltaBroadcaster(
  send: (text: string) => Promise<void>,
  { intervalMs = 100, now = () => Date.now() }: DeltaBroadcasterOptions = {},
): DeltaBroadcaster {
  let assembled = '';
  let lastSentAt = 0;
  let lastSentLength = 0;
  /**
   * ⛔ Explicit, because the first increment must go out **immediately** — the whole perceived-speed
   * win is the gap between "sent" and "something appears". Without this flag it worked only by
   * accident: `now() - 0` is ~1.7e12 with a real clock, so the first push happened to exceed any
   * interval. A test with a fake clock starting at 0 exposed that the behaviour rested on the
   * absolute value of the clock rather than on anything intended.
   */
  let hasSent = false;
  let inFlight: Promise<void> = Promise.resolve();

  const dispatch = () => {
    hasSent = true;
    lastSentAt = now();
    lastSentLength = assembled.length;
    const payload = assembled;
    // ⚠️ Chained rather than awaited: `push` is called from the read loop and must not slow the
    // provider read down. A failed broadcast is swallowed — losing a delta costs a stutter, and the
    // final `result` still carries the whole answer.
    inFlight = inFlight.then(() => send(payload)).catch(() => {});
  };

  return {
    push(increment: string) {
      if (!increment) return;
      assembled += increment;
      if (!hasSent || now() - lastSentAt >= intervalMs) dispatch();
    },

    async flush() {
      // Only when something is actually pending. Flushing an unchanged buffer would send a
      // duplicate of the last delta immediately before the authoritative result.
      if (assembled.length > lastSentLength) dispatch();
      await inFlight;
    },

    text: () => assembled,
  };
}
