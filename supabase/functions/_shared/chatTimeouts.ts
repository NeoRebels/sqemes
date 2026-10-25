/**
 * SQEM-381 — every timeout in the chat chain, in ONE place, with the platform limit they sit under.
 *
 * ⛔ **Read by the edge function AND the browser** — a real import on both sides, the way SQEM-378
 * established for import-free modules. The two ends of a timeout chain have to agree with each other
 * or the wrong one fires first, and "agree" written in two files is how they stop agreeing.
 *
 * The chain, and why each number is what it is:
 *
 *   provider call (fetchWithTimeout)  →  client waits (JOB_TIMEOUT)  →  platform kills the worker
 *
 * ⛔ **The client must outlast the provider call.** If the client gives up first, the honest 504 the
 * server produces a moment later arrives at nobody, and the user sees a generic "took too long"
 * instead of "the provider did not respond". Every pair below keeps client > provider.
 *
 * ⛔ **Both must finish under the platform's wall clock.** A killed worker broadcasts NOTHING — no
 * result, no error — so the user watches a spinner until the client gives up. That is strictly worse
 * than a timeout. `tests/unit/chatTimeouts.test.ts` pins both invariants.
 *
 * ⚠️ **The platform limit depends on the plan, and NOBODY here can read the plan from code.** Free
 * plans get 150 s, paid plans 400 s (Supabase docs, checked 2026-09-11). **Cloud production is on a
 * PAID plan** — owner, 2026-09-11, in those words: *"we have no free plan at all"*. A self-hosted
 * instance may be either. `EDGE_PLAN_IS_PAID` is the operator's statement of that fact, in one
 * place, read by both ends.
 *
 * ⛔ **Under a 150 s wall clock no provider call may exceed it**, whatever the connector count. A
 * 300 s provider timeout on a 150 s worker does not give the model more time; it turns an honest 504
 * at 120 s into a killed worker at 150 s that broadcasts nothing. That is why the flag exists at all,
 * and why self-host — whose plan we cannot know — never gets the long pair regardless of it.
 *
 * ⚠️ **This flag was `false` for one promotion (#1070, 2026-09-11) because of a misread reply, not
 * because of the plan.** The owner had confirmed paid; "adjust point 2 first" was read as "the
 * assumption is wrong". The long pair the owner had approved in #1069 was switched off on production
 * for the duration. The lesson is not about timeouts: a material decision resting on an ambiguous
 * sentence gets a question, not an interpretation — and nothing is ever written down as the owner's
 * statement unless it is a quote.
 *
 * ⚠️ **The 120 s default was chosen for image generation** (commit 4538bfe, 2026-02-23: "image
 * generation requests which can take 60–90 seconds"). Connectors arrived five months later and
 * inherited it. With `mcp_servers`, Claude and OpenAI execute every remote tool call INSIDE that one
 * HTTP request — model thinks, calls a connector, thinks, calls another — so each extra connector
 * packs more round trips into the same budget. That is what the longer pair is for.
 */

/** Supabase Edge Functions — maximum wall-clock duration per worker, `waitUntil` included. */
export const EDGE_WALL_CLOCK_MS = {
  free: 150_000,
  paid: 400_000,
} as const;

/**
 * ⛔ **Whether the Supabase plan this code runs under allows 400 s.** Nothing in the code can verify
 * this; the flag is the operator's statement. A wrong `true` is the silent-worker-death trap
 * described above; a wrong `false` silently withholds the connector fix — which is what happened for
 * one promotion.
 *
 * Cloud production: **paid plan** (owner, 2026-09-11). Self-host is handled separately — the
 * `selfHosted` context keeps the default pair no matter what this says, because a self-hoster's plan
 * is theirs and unknown to us.
 */
export const EDGE_PLAN_IS_PAID = true;

/**
 * How long one provider request may take before `fetchWithTimeout` aborts it with a 504.
 *
 * ⭐ **SQEM-582 — on a paid Cloud wall clock EVERY chat turn gets `long`, not only turns with
 * connectors.** Reasoning models think for minutes before the first byte; with 120 s a hard question
 * ended in "did not respond within 120 seconds" although nothing was wrong. The budget still fits:
 * the tool budget (90 s, no new round after it) plus one provider call (≤ 300 s) is 390 s, under the
 * 400 s wall clock — the same arithmetic connector turns have run on since SQEM-381.
 */
export const PROVIDER_TIMEOUT_MS = {
  /** Self-host (a possible 150 s wall clock), authoring, images. The original number. */
  default: 120_000,
  /** Every chat turn on a paid Cloud wall clock. */
  long: 300_000,
} as const;

/** How long the browser waits for the job's terminal broadcast. Always > the provider timeout. */
export const CLIENT_JOB_TIMEOUT_MS = {
  default: 180_000,
  long: 330_000,
} as const;

/**
 * SQEM-582 — a streaming answer is not a stalled one. Each delta moves the client's deadline to
 * `now + DELTA_GRACE_MS`, never past `hardCap`. A stream that stalls still ends — at most this long
 * after its last delta — which is the case the old "deltas never touch the timeout" rule guarded.
 */
export const DELTA_GRACE_MS = 60_000;

/** The latest moment the client may still be waiting: just under the wall clock where it applies. */
export function clientHardCapMs(ctx: TimeoutContext): number {
  return longPair(ctx) ? EDGE_WALL_CLOCK_MS.paid - 10_000 : clientJobTimeoutMs(ctx);
}

/** The client's deadline after a delta arrives at `now` (all values are absolute ms timestamps). */
export function nextJobDeadline(current: number, now: number, startedAt: number, hardCapMs: number): number {
  return Math.min(Math.max(current, now + DELTA_GRACE_MS), startedAt + hardCapMs);
}

export interface TimeoutContext {
  /**
   * Remote MCP connectors are attached to this turn. Since SQEM-582 it no longer decides the pair —
   * every Cloud chat turn gets the long one; kept so callers can still say it.
   */
  connectors?: boolean;
  /**
   * Running on a self-hosted instance. ⛔ Keeps the default pair even with connectors and even if
   * `EDGE_PLAN_IS_PAID` is flipped for Cloud: that flag is a statement about OUR plan, and a
   * self-hoster's Supabase is theirs. A paid self-host can get a follow-up if anyone ever asks.
   */
  selfHosted: boolean;
  /**
   * The wall clock allows the long pair. Defaults to `EDGE_PLAN_IS_PAID`; a parameter only so the
   * tests can exercise both worlds without editing the constant.
   */
  paidPlan?: boolean;
}

/** The long pair: a paid wall clock AND not a self-host (SQEM-582 — connectors no longer required). */
function longPair({ selfHosted, paidPlan = EDGE_PLAN_IS_PAID }: TimeoutContext): boolean {
  return paidPlan && !selfHosted;
}

export function providerTimeoutMs(ctx: TimeoutContext): number {
  return longPair(ctx) ? PROVIDER_TIMEOUT_MS.long : PROVIDER_TIMEOUT_MS.default;
}

export function clientJobTimeoutMs(ctx: TimeoutContext): number {
  return longPair(ctx) ? CLIENT_JOB_TIMEOUT_MS.long : CLIENT_JOB_TIMEOUT_MS.default;
}
