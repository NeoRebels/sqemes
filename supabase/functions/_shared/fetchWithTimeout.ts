/**
 * Wraps fetch with an AbortController timeout.
 * Returns a 504-style error if the upstream doesn't respond in time.
 *
 * ⚠️ **The default was chosen for image generation** (commit 4538bfe, 2026-02-23) and every caller
 * used it for two years. SQEM-381 made the connector paths pass their own — see
 * `_shared/chatTimeouts.ts` for the chain and the invariants the numbers have to satisfy.
 *
 * ⚠️ **For a streamed response this bounds time-to-first-byte only.** `clearTimeout` runs in
 * `finally`, i.e. as soon as the headers are back; the body read is bounded by the client's job
 * timeout instead, which deliberately does not refresh on deltas (SQEM-372). That is by construction,
 * not an oversight — but it means a non-streaming call (connectors, funded) is the one this number
 * governs end to end.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 120_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // SQEM-583 — a signal from outside (the person pressed Stop) aborts the same controller. The listener
  // stays after the headers: it is what ends a stream that is still being read.
  const outer = options.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err: unknown) {
    // A stop is not a timeout: reported as an AbortError, never as the 504 below.
    if (outer?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    if (err instanceof Error && err.name === 'AbortError') {
      throw Object.assign(new Error(`LLM provider did not respond within ${Math.round(timeoutMs / 1000)} seconds. Please try again.`), {
        status: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
