/**
 * SQEM-652/654 — the tokens a provider round reports, streamed or not, for the `[chat-tools]` log:
 * input, output, and the part of the input the provider served from its prompt cache.
 *
 * Claude streams `message_start` (input = uncached + cache reads + cache writes) and `message_delta`
 * (output); a whole body carries `usage`. OpenAI Responses streams `response.completed`. Gemini puts
 * `usageMetadata` on its chunks — CUMULATIVE within a round, so the caller keeps the last one per round
 * (`latest`), never a sum. Chat-completions providers report `usage` once, on the last chunk; DeepSeek
 * names the cached part `prompt_cache_hit_tokens`, the others `prompt_tokens_details.cached_tokens`.
 * Anything else counts nothing. Pure, so tests pin every shape.
 */
/**
 * `written` — SQEM-654: tokens the provider wrote INTO its cache this round. Only Claude reports them (and
 * bills them at 1.25×); OpenAI, Gemini and DeepSeek cache implicitly without a write price.
 */
export interface TokenCount { input: number; output: number; cached: number; written?: number }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const NONE: TokenCount = { input: 0, output: 0, cached: 0 };
const claudeWritten = (u: any): number => n(u?.cache_creation_input_tokens);

function claudeInput(u: any): number {
  return n(u?.input_tokens) + n(u?.cache_read_input_tokens) + n(u?.cache_creation_input_tokens);
}

/** One Claude stream event or a whole Messages API body. */
export function claudeUsage(chunk: unknown): TokenCount {
  const c = chunk as any;
  if (c?.type === 'message_start') return { input: claudeInput(c.message?.usage), output: n(c.message?.usage?.output_tokens), cached: n(c.message?.usage?.cache_read_input_tokens), written: claudeWritten(c.message?.usage) };
  if (c?.type === 'message_delta') return { input: 0, output: n(c.usage?.output_tokens), cached: 0 };
  if (c?.type === 'message' && c.usage) return { input: claudeInput(c.usage), output: n(c.usage.output_tokens), cached: n(c.usage.cache_read_input_tokens), written: claudeWritten(c.usage) };
  return NONE;
}

/** One OpenAI Responses stream event or a whole Responses body. */
export function responsesUsage(chunk: unknown): TokenCount {
  const c = chunk as any;
  const u = c?.type === 'response.completed' ? c.response?.usage : c?.object === 'response' ? c.usage : null;
  return u ? { input: n(u.input_tokens), output: n(u.output_tokens), cached: n(u.input_tokens_details?.cached_tokens) } : NONE;
}

/** A Gemini chunk or body. ⚠️ Cumulative per round when streamed — keep the last, do not add. */
export function geminiUsage(chunk: unknown): TokenCount | null {
  const u = (chunk as any)?.usageMetadata;
  if (!u) return null;
  return { input: n(u.promptTokenCount), output: n(u.candidatesTokenCount), cached: n(u.cachedContentTokenCount) };
}

/** The `usage` object of a chat-completions response (Mistral, DeepSeek, Grok, OpenRouter). */
export function chatCompletionsUsage(usage: unknown): TokenCount {
  const u = usage as any;
  if (!u) return NONE;
  return { input: n(u.prompt_tokens), output: n(u.completion_tokens), cached: n(u.prompt_tokens_details?.cached_tokens) || n(u.prompt_cache_hit_tokens) };
}

/** Add one count to the answer's stats. */
export function addUsage(stats: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number } | undefined, t: TokenCount | null): void {
  if (!stats || !t || (!t.input && !t.output && !t.cached && !t.written)) return;
  stats.inputTokens = (stats.inputTokens ?? 0) + t.input;
  stats.outputTokens = (stats.outputTokens ?? 0) + t.output;
  stats.cachedInputTokens = (stats.cachedInputTokens ?? 0) + t.cached;
  if (t.written) stats.cacheWriteTokens = (stats.cacheWriteTokens ?? 0) + t.written;
}
