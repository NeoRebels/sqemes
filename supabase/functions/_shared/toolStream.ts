/**
 * SQEM-373 — assembling a tool call out of a token stream.
 *
 * ⛔ **A tool call does not arrive whole.** Both wire formats that matter split it: OpenAI sends
 * `tool_calls[i].function.arguments` as a run of fragments that concatenate into one JSON string,
 * Claude sends `input_json_delta.partial_json` the same way. A reader that took the first chunk it
 * saw would call a tool with `{"na` as its arguments — and the failure would look like a model
 * mistake rather than a parser bug.
 *
 * ⚠️ **OpenAI keys its fragments by `index`, not by id.** The id arrives once, on the first fragment
 * of each call; every later fragment for that call carries only the index. Keying on id would open a
 * new entry for each nameless fragment and lose the arguments.
 *
 * ⛔ Free of imports, including Deno ones, so these are unit-testable.
 * See `docs/ai/modules/testing.md` in the source repository for why that matters.
 */

/** One call the model wants made. `args` is the raw JSON text; parsing is the caller's job. */
export interface StreamedToolCall {
  /** Provider-assigned id, echoed back with the result so the model can pair them. */
  id: string;
  name: string;
  /** Raw JSON text. Empty string for a no-argument call. */
  args: string;
  /**
   * ⛔ **The provider's own part, kept so it can be echoed back UNCHANGED.**
   *
   * Gemini's thinking models attach a `thoughtSignature` to the part carrying a `functionCall`, and
   * **reject the next request outright if it comes back without it**:
   *
   * > *400 — Function call is missing a thought_signature in functionCall parts. This is required
   * > for tools to work correctly … position 4.*
   *
   * ⚠️ Rebuilding the part from `name` + `args` looks equivalent and is not: the signature is opaque,
   * it cannot be reconstructed, and dropping it is a hard error rather than a degradation. So the
   * part is carried through verbatim and handed straight back. Only Gemini needs this today; the
   * field is generic because the reason — *the provider gave us something we cannot regenerate* — is
   * not Gemini-specific.
   */
  raw?: Record<string, unknown>;
}

export interface ToolAccumulator {
  /** Hand it every parsed SSE chunk. */
  onChunk(chunk: unknown): void;
  /** The calls assembled so far, in the order the provider opened them. */
  calls(): StreamedToolCall[];
}

/**
 * Parses accumulated argument text, tolerating the two shapes that are not objects.
 *
 * ⚠️ An empty string means "no arguments" and must become `{}`, not a parse error: a tool with no
 * required parameters (`list_personas`) is called exactly that way by several providers.
 */
export function parseToolArgs(args: string): Record<string, unknown> {
  const text = (args || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // A truncated or malformed argument string. Returning `{}` lets the handler answer with its own
    // "missing id or name" message, which the model can act on — better than an exception that
    // reaches the user as a failed request for something it could have retried.
    return {};
  }
}

/** OpenAI chat completions, and every OpenAI-compatible endpoint. */
export function createOpenAiToolAccumulator(): ToolAccumulator {
  const byIndex = new Map<number, StreamedToolCall>();
  const order: number[] = [];

  return {
    onChunk(chunk) {
      const calls = (chunk as { choices?: { delta?: { tool_calls?: any[] } }[] })
        ?.choices?.[0]?.delta?.tool_calls;
      if (!Array.isArray(calls)) return;

      for (const c of calls) {
        const index = typeof c?.index === 'number' ? c.index : 0;
        let entry = byIndex.get(index);
        if (!entry) {
          entry = { id: '', name: '', args: '' };
          byIndex.set(index, entry);
          order.push(index);
        }
        // Each field appears on the fragment that carries it and is absent from the rest, so every
        // one is applied conditionally rather than overwritten with undefined.
        if (c.id) entry.id = c.id;
        if (c.function?.name) entry.name += c.function.name;
        if (typeof c.function?.arguments === 'string') entry.args += c.function.arguments;
      }
    },
    calls: () => order.map(i => byIndex.get(i)!).filter(c => c.name),
  };
}

/**
 * Anthropic messages.
 *
 * ⚠️ The name and id arrive on `content_block_start`, the arguments on the `input_json_delta`s that
 * follow — and the block index is the only thing tying them together, because a reply can open a
 * text block and a tool block on the same stream.
 */
export function createClaudeToolAccumulator(): ToolAccumulator {
  const byIndex = new Map<number, StreamedToolCall>();
  const order: number[] = [];

  return {
    onChunk(chunk) {
      const c = chunk as {
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string };
        delta?: { type?: string; partial_json?: string };
      };
      const index = typeof c?.index === 'number' ? c.index : 0;

      if (c?.type === 'content_block_start' && c.content_block?.type === 'tool_use') {
        byIndex.set(index, { id: c.content_block.id || '', name: c.content_block.name || '', args: '' });
        order.push(index);
        return;
      }

      if (c?.type === 'content_block_delta' && c.delta?.type === 'input_json_delta') {
        const entry = byIndex.get(index);
        // No entry means this delta belongs to a block we did not open as a tool — ignore it rather
        // than inventing a call with no name.
        if (entry) entry.args += c.delta.partial_json ?? '';
      }
    },
    calls: () => order.map(i => byIndex.get(i)!).filter(c => c.name),
  };
}

/**
 * Gemini `streamGenerateContent?alt=sse`.
 *
 * ⭐ The one provider that does NOT split a call: `functionCall` arrives complete inside a part, so
 * there is nothing to reassemble. Its args are an object rather than a JSON string — re-serialised
 * here so all three accumulators hand back the same shape and the dispatcher stays provider-blind.
 */
export function createGeminiToolAccumulator(): ToolAccumulator {
  const out: StreamedToolCall[] = [];
  let seq = 0;

  return {
    onChunk(chunk) {
      const parts = (chunk as { candidates?: { content?: { parts?: any[] } }[] })
        ?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return;

      for (const p of parts) {
        const fc = p?.functionCall;
        if (!fc?.name) continue;
        // Gemini assigns no call id. One is synthesised so the executor's logging and the loop's
        // pairing work identically across providers; it is never sent back on the wire, because
        // `functionResponse` pairs by NAME.
        seq += 1;
        // ⛔ `raw: p` keeps the WHOLE part, `thoughtSignature` included — see `StreamedToolCall.raw`.
        out.push({ id: `gemini_${seq}`, name: fc.name, args: JSON.stringify(fc.args ?? {}), raw: p });
      }
    },
    calls: () => out,
  };
}

// ── Non-streaming reads, and the turns that go back ─────────────────────────
//
// ⚠️ **Both halves are needed for every provider.** The non-streaming read exists because the funded
// path and the connector path do not stream (SQEM-372) — leaving it out would have made tool calling
// a BYOK-only feature by accident. The turn builders exist because a tool result is only accepted
// when it is paired with the assistant turn that asked for it; sending the result alone is rejected
// by all three APIs with an error that names the message index, not the cause.

/** OpenAI chat completions — `choices[0].message`, non-streaming. */
export function readOpenAiToolCalls(message: any): StreamedToolCall[] {
  return ((message?.tool_calls as any[] | undefined) || [])
    .filter(c => c?.function?.name)
    .map(c => ({ id: c.id || '', name: c.function.name, args: c.function.arguments ?? '' }));
}

/**
 * The assistant turn that asked for the calls.
 *
 * ⚠️ `content` is `null` rather than `''` when the model said nothing before calling: an empty
 * string is a valid assistant message in the schema, and some compatible endpoints then treat the
 * turn as a spoken reply and refuse the `tool` messages that follow.
 */
export function openAiAssistantTurn(text: string, calls: StreamedToolCall[]): Record<string, unknown> {
  return {
    role: 'assistant',
    content: text || null,
    tool_calls: calls.map(c => ({
      id: c.id, type: 'function',
      function: { name: c.name, arguments: c.args || '{}' },
    })),
  };
}

/** Anthropic messages — the `content` array, non-streaming. */
export function readClaudeToolCalls(content: any[] | undefined): StreamedToolCall[] {
  return (content || [])
    .filter(b => b?.type === 'tool_use' && b?.name)
    .map(b => ({ id: b.id || '', name: b.name, args: JSON.stringify(b.input ?? {}) }));
}

/**
 * ⚠️ An empty text block is REJECTED by the Messages API, so the text block is only included when
 * there is text. A model that calls a tool without saying anything first is the common case.
 */
export function claudeAssistantTurn(text: string, calls: StreamedToolCall[]): Record<string, unknown> {
  const content: any[] = [];
  if (text.trim()) content.push({ type: 'text', text });
  for (const c of calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: parseToolArgs(c.args) });
  return { role: 'assistant', content };
}

/** Claude takes tool results as a USER turn — all of them in one message, not one message each. */
export function claudeToolResults(results: { id: string; output: string }[]): Record<string, unknown> {
  return {
    role: 'user',
    content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.output })),
  };
}

/** Gemini — `candidates[0].content.parts`, non-streaming. */
export function readGeminiToolCalls(parts: any[] | undefined): StreamedToolCall[] {
  return (parts || [])
    .filter(p => p?.functionCall?.name)
    .map((p, i) => ({
      id: `gemini_${i + 1}`,
      name: p.functionCall.name,
      args: JSON.stringify(p.functionCall.args ?? {}),
      raw: p, // ⛔ verbatim, for `thoughtSignature` — see `StreamedToolCall.raw`
    }));
}

/**
 * ⛔ **A captured part goes back UNCHANGED; only a missing one is rebuilt.**
 *
 * Gemini rejects a `functionCall` part that returns without its `thoughtSignature`, and the signature
 * is opaque — there is nothing to reconstruct it from. The rebuild is kept only for a call that never
 * carried a part (a hand-written test, a provider that stops sending one).
 *
 * ⚠️ **Known gap:** a `thoughtSignature` on a *text* part is still dropped. That one is documented as
 * degrading quality rather than failing the request, so it is not worth reassembling streamed text
 * chunk-for-chunk to preserve. If Gemini ever makes it a hard error, this is the place.
 */
export function geminiModelTurn(text: string, calls: StreamedToolCall[]): Record<string, unknown> {
  const parts: any[] = [];
  if (text.trim()) parts.push({ text });
  for (const c of calls) {
    parts.push(c.raw ?? { functionCall: { name: c.name, args: parseToolArgs(c.args) } });
  }
  return { role: 'model', parts };
}

/**
 * ⚠️ Gemini pairs a result to its call by **name**, not by id — it issues no call ids at all. Two
 * calls to the same tool in one round are therefore indistinguishable to it; they are sent in order
 * and the model matches them positionally, which is the protocol's own behaviour and not something
 * this code can improve on.
 *
 * `response` must be an OBJECT. A bare string is rejected.
 */
export function geminiToolResults(results: { name: string; output: string }[]): Record<string, unknown> {
  return {
    role: 'user',
    parts: results.map(r => ({ functionResponse: { name: r.name, response: { output: r.output } } })),
  };
}
