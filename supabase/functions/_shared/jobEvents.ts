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
// SQEM-649 — `continued`: the answer goes on in a new invocation; the browser moves its deadline.
// SQEM-660 — `analysis`: a program for the browser to run (run_analysis); not terminal.
// SQEM-661 — `analysis_table`: one part of a connector table, sent ahead of the program that needs it.
// SQEM-674 — `alive`: the answer is still running (heartbeat); not terminal.
// SQEM-686 — `checkpoint`: one part of the state after a finished round; `tools`: a round's tools run now.
export const JOB_EVENTS = ['delta', 'continued', 'analysis_table', 'analysis', 'alive', 'checkpoint', 'tools', 'result'] as const;

export type JobEvent = typeof JOB_EVENTS[number];

/**
 * Which event a payload goes out under.
 *
 * ⭐ Derived from the payload rather than passed in by the caller, on purpose: a parameter is one
 * more thing a future call site can forget, and forgetting it is precisely what happened. A payload
 * carrying `delta` **is** a delta; everything else — `result`, `error` — is terminal.
 */
export function jobEventFor(payload: Record<string, unknown>): JobEvent {
  if ('delta' in payload) return 'delta';
  if ('continued' in payload) return 'continued'; // SQEM-649 — not terminal
  if ('analysisTable' in payload) return 'analysis_table'; // SQEM-661 — not terminal
  if ('analysis' in payload) return 'analysis'; // SQEM-660 — not terminal
  if ('alive' in payload) return 'alive'; // SQEM-674 — not terminal (it may carry `toolsRound` too, SQEM-686)
  if ('checkpoint' in payload) return 'checkpoint'; // SQEM-686 — not terminal
  if ('toolsRound' in payload) return 'tools'; // SQEM-686 — not terminal
  return 'result';
}
