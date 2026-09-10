/**
 * SQEM-374 — the names a background job broadcasts under, in ONE place.
 *
 * ⛔ **This module exists because a hardcoded event name silently broke the whole chat.**
 * `broadcast.ts` wrote `event: 'result'` into every message. SQEM-372 then added deltas and called
 * `broadcastJobResult(jobId, { delta })` — so a delta went out **as a result**, the client's result
 * handler fired on it, read `payload.result` (undefined), resolved the promise with `''`, tore the
 * channel down, and the real answer arrived at nobody. Every streamed reply was an empty bubble, with
 * no error anywhere.
 *
 * ⚠️ **Both ends had a passing test.** `chatStreaming.test.ts` asserted that the client listens for
 * `event: 'delta'` and that `chat-message` broadcasts `{ delta: text }`. Neither side was wrong;
 * nothing checked that they used the same word. Source assertions are blind to exactly this — a
 * contract between two files that no single file states.
 *
 * ⛔ Deliberately free of imports, including Deno ones: `broadcast.ts` reads `Deno.env` at module
 * load and therefore cannot be pulled into a unit test. The rule that broke lives here instead,
 * where a test can reach it. See `docs/ai/modules/testing.md` in the source repository.
 */

/**
 * Every event a job can broadcast. **The client must listen for all of them** —
 * `tests/unit/jobEvents.test.ts` checks that against `lib/realtimeJob.ts`.
 */
export const JOB_EVENTS = ['delta', 'result'] as const;

export type JobEvent = typeof JOB_EVENTS[number];

/**
 * Which event a payload goes out under.
 *
 * ⭐ Derived from the payload rather than passed in by the caller, on purpose: a parameter is one
 * more thing a future call site can forget, and forgetting it is precisely what happened. A payload
 * carrying `delta` **is** a delta; everything else — `result`, `error` — is terminal.
 */
export function jobEventFor(payload: Record<string, unknown>): JobEvent {
  return 'delta' in payload ? 'delta' : 'result';
}
