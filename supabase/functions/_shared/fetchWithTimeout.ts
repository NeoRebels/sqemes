/**
 * Wraps fetch with an AbortController timeout.
 * Returns a 504-style error if the upstream doesn't respond in time.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 120_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw Object.assign(new Error('LLM provider did not respond within 120 seconds. Please try again.'), {
        status: 504,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
