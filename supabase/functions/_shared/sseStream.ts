/**
 * SQEM-372 — one SSE reader for every provider.
 *
 * All four provider shapes (Gemini `?alt=sse`, OpenAI chat completions, Anthropic messages, and the
 * OpenAI-compatible endpoints) speak the same transport: `data: <json>` lines separated by blank
 * lines. **Only the shape of the JSON differs.** So the transport is written once here and each
 * provider contributes a three-line extractor.
 *
 * ⛔ Deliberately free of imports, including Deno ones, so it can be unit-tested. Anything reaching
 * `lib/supabase` throws at import time without env vars and is green locally, red in CI.
 * See `docs/ai/modules/testing.md` in the source repository.
 *
 * ⚠️ **This exists because nothing streamed.** A comment in both edge functions claimed "All text
 * models use SSE streaming"; it arrived with SQEM-017, the commit that replaced streaming with the
 * background-job design, and outlived it by months.
 */

/** Pulls the text increment out of one provider chunk, or null when the chunk carries none. */
export type DeltaExtractor = (chunk: unknown) => string | null;

export interface SseResult {
  /** Everything the provider sent, assembled. */
  text: string;
  /** Chunks that could not be parsed — surfaced rather than swallowed, but never fatal. */
  skipped: number;
}

/**
 * Reads an SSE body to completion, handing every text increment to `onDelta` as it arrives and
 * returning the assembled whole.
 *
 * ⚠️ **Line buffering is the part that has to be right.** A chunk from the network boundary can
 * split a `data:` line in half; parsing per read would drop it, and the user would see a hole in
 * the middle of a sentence with nothing reporting an error. The tail of each read is carried over.
 */
export async function readSSE(
  body: ReadableStream<Uint8Array> | null,
  extract: DeltaExtractor,
  onDelta: (increment: string) => void,
  /**
   * SQEM-373 — every parsed chunk, before the text extractor sees it.
   *
   * ⭐ Tool calls ride the SAME stream as the text, in pieces: OpenAI splits a call's arguments
   * across `tool_calls[i].function.arguments` fragments, Claude across `input_json_delta`. So there
   * is no second connection to open and no non-streaming fallback to fall into — the accumulator
   * just watches the chunks go past. Adding a parameter beat a second reader: two readers over one
   * body is not possible, and reading twice would mean buffering the whole response first, which is
   * precisely what streaming exists to avoid.
   */
  onChunk?: (chunk: unknown) => void,
): Promise<SseResult> {
  if (!body) return { text: '', skipped: 0 };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let skipped = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines, keep the trailing partial line for the next read.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith(':')) continue;      // keep-alive comment
        if (!line.startsWith('data:')) continue;           // `event:` / `id:` lines carry no text

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          // ⚠️ Counted, not thrown. One unparseable chunk must not lose an answer that is otherwise
          // complete — but silently discarding it would hide a provider changing its format.
          skipped += 1;
          continue;
        }

        onChunk?.(parsed);

        const increment = extract(parsed);
        if (increment) {
          text += increment;
          onDelta(increment);
        }
      }
    }
  } finally {
    // Releasing matters even on an early exit: an unreleased reader keeps the connection open for
    // the rest of the function's lifetime, and this runs inside `waitUntil` where nothing else will
    // clean it up.
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  return { text, skipped };
}

// ── Per-provider extractors ──────────────────────────────────────────────────
//
// Each one is deliberately tiny and total: given any chunk, return the text increment or null.
// Anything unexpected returns null rather than throwing — a provider that adds a new event type
// should cost nothing.

/** Gemini `streamGenerateContent?alt=sse`. */
export const geminiDelta: DeltaExtractor = (chunk) => {
  const parts = (chunk as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map(p => p?.text ?? '').join('');
  return text || null;
};

/** OpenAI chat completions, and every OpenAI-compatible endpoint (DeepSeek, Mistral, Grok, OpenRouter). */
export const openAiDelta: DeltaExtractor = (chunk) => {
  const delta = (chunk as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta;
  return delta?.content || null;
};

/**
 * Anthropic messages.
 *
 * ⚠️ Only `content_block_delta` carries text. `message_start`, `ping`, `content_block_start` and
 * `message_delta` all arrive on the same stream and must contribute nothing — an extractor that
 * reached for `.text` anywhere it found one would emit stray fragments.
 */
export const claudeDelta: DeltaExtractor = (chunk) => {
  const c = chunk as { type?: string; delta?: { type?: string; text?: string } };
  if (c?.type !== 'content_block_delta') return null;
  if (c.delta?.type !== 'text_delta') return null;
  return c.delta.text || null;
};
