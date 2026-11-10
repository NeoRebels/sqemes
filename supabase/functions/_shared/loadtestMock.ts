/**
 * SQEM-500 — a simulated chat provider, for load tests on STAGING only.
 *
 * It lets a load test measure OUR side of a chat — auth, membership, paywall, budget, the background
 * job, the library tools, streaming over Realtime — without paying a model provider per message and
 * without measuring the provider's speed instead of ours.
 *
 * ⛔ **Unreachable unless BOTH hold, on every request:**
 *   1. the environment variable `CHAT_LOADTEST_SECRET` is set (≥ 32 characters) — it exists only in
 *      the staging project's secrets; production and every self-hosted instance do not have it;
 *   2. the request carries that exact secret in the `x-sqemes-loadtest` header.
 * Without both, the model id is just an unknown model and chat-message rejects it like any other.
 * The check is a pure function so the test (tests/unit/loadtestMock.test.ts) can pin every way it must
 * say no.
 */
export const LOADTEST_MODEL = 'sqemes-loadtest-mock';
/**
 * SQEM-673 — a run that lasts like a routine with tool rounds: `sqemes-loadtest-mock:<seconds>` streams
 * its answer over that many seconds (at most 300, an invocation's wall clock is ~400 s). The suffix lives
 * in the model id so it travels with the request through every hand-over and needs no new field.
 */
const TIMED_MODEL = /^sqemes-loadtest-mock:(\d{1,3})(:quiet|:die)?(:nobeat)?$/;
export const MAX_LOADTEST_SECONDS = 300;
/**
 * SQEM-673 — `…:<seconds>:quiet` streams nothing and only answers at the end, like a routine with nobody
 * watching would. In load tests, streaming runs packed onto one worker exceed its CPU time and the
 * worker takes every run on it down at once; this variant shows what the same runs cost without it.
 */
export function loadtestQuiet(modelId: unknown): boolean {
  return typeof modelId === 'string' && modelId.match(TIMED_MODEL)?.[2] === ':quiet';
}
/**
 * SQEM-674 — `…:<seconds>:die` behaves like a run whose worker was killed: the heartbeat stops after
 * `LOST_AFTER_MS` and no answer ever arrives. It is the only way to show the browser's "interrupted"
 * message on purpose; a real CPU kill needs hundreds of runs at once.
 */
export function loadtestDies(modelId: unknown): boolean {
  return typeof modelId === 'string' && modelId.match(TIMED_MODEL)?.[2] === ':die';
}
export const LOST_AFTER_MS = 20_000;
/**
 * SQEM-676 — `…:nobeat` (after `:quiet` or `:die`, or alone) runs without the SQEM-674 heartbeat. Only for
 * the A/B measurement of what the heartbeat costs under load; behind the load-test secret like every variant.
 */
export function loadtestNoBeat(modelId: unknown): boolean {
  return typeof modelId === 'string' && modelId.match(TIMED_MODEL)?.[3] === ':nobeat';
}

/** SQEM-674 — stop the heartbeat, stay silent for the rest of `seconds`, then fail to nobody. */
export async function simulateLostWorker(
  heartbeat: { stop: () => void },
  seconds: number,
  sleep: (ms: number) => Promise<unknown> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<never> {
  await sleep(LOST_AFTER_MS);
  heartbeat.stop();
  await sleep(Math.max(0, seconds * 1000 - LOST_AFTER_MS));
  throw new Error('loadtest: simulated lost worker');
}
export function loadtestSeconds(modelId: unknown): number | null {
  const m = typeof modelId === 'string' ? modelId.match(TIMED_MODEL) : null;
  return m ? Math.min(Number(m[1]), MAX_LOADTEST_SECONDS) : null;
}
export const LOADTEST_HEADER = 'x-sqemes-loadtest';
const MIN_SECRET_LENGTH = 32;

/** Constant-time comparison: the time to say "no" must not depend on how much of the secret matched. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isLoadtestRequest(
  modelId: unknown,
  headerValue: string | null | undefined,
  envSecret: string | null | undefined,
): boolean {
  if (modelId !== LOADTEST_MODEL && loadtestSeconds(modelId) === null) return false;
  if (typeof envSecret !== 'string' || envSecret.length < MIN_SECRET_LENGTH) return false;
  if (typeof headerValue !== 'string') return false;
  return sameSecret(headerValue, envSecret);
}

interface MockTools {
  execute(name: string, args: Record<string, unknown>): Promise<string>;
}

/**
 * Behaves like a model that consults the library once and then answers: one search, one playbook
 * load (`list` mode, as Chat uses it), then ~`tokens` streamed deltas with `delayMs` between them.
 */
export async function runLoadtestMock(
  onDelta: ((text: string) => void) | undefined,
  tools: MockTools | null,
  { tokens = 60, delayMs = 30, seconds = null, sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) }:
    { tokens?: number; delayMs?: number; seconds?: number | null; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<string> {
  // SQEM-673 — a timed run spreads the same tokens over the requested seconds.
  if (seconds != null) delayMs = Math.round((seconds * 1000) / tokens);
  let loaded = 'no library';
  if (tools) {
    const found = await tools.execute('search_templates', { query: 'design' });
    let first: string | undefined;
    try { first = (JSON.parse(found) as Array<{ name?: string }>)[0]?.name; } catch { /* not a list */ }
    if (first) {
      await tools.execute('get_template', { name: first, include_files: 'list' });
      loaded = first;
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < tokens; i++) {
    const piece = i === 0 ? `[loadtest: ${loaded}] ` : `token${i} `;
    parts.push(piece);
    onDelta?.(piece);
    await sleep(delayMs);
  }
  return parts.join('');
}
