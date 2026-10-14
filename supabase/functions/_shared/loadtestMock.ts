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
  if (modelId !== LOADTEST_MODEL) return false;
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
  { tokens = 60, delayMs = 30, sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) }:
    { tokens?: number; delayMs?: number; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<string> {
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
