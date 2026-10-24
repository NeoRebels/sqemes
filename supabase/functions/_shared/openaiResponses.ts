/**
 * SQEM-377 — OpenAI over `/v1/responses`, and why it is now the ONLY OpenAI path.
 *
 * ⛔ **The ticket left one decision open: replace the chat-completions path, or add a second one?**
 * Replaced — and the argument is not tidiness. `chat-message` already carried **two** OpenAI paths
 * (`callOpenAI` for plain chat, `callOpenAIResponses` for connectors since SQEM-149). Adding a third
 * for tools would have been the fourth twin in this repo after the CI workflows,
 * `callOpenAICompatible` and the library handlers. Folding all three into one **removes** a twin
 * instead of adding one.
 *
 * ⚠️ It also means a working path was touched. The mitigation is that everything shape-related lives
 * here, pure and import-free, and is unit-tested — `chat-message` only wires it up.
 *
 * ⭐ **The rule that runs through this module: echo the model's output items back VERBATIM.** One
 * sentence covers reasoning items, function calls and messages alike, and it is the lesson SQEM-376
 * paid for two hours earlier — a provider hands us something we cannot regenerate, so we must not
 * rebuild it.
 */

/** A chat turn as `chat-message` holds it before any provider shaping. */
export interface ChatLikeMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

/** Decodes a `text/*` inlineData part to plain text. Injected so this module stays import-free. */
export type TextDecoderFn = (inlineData: { mimeType: string; data: string }) => string;

/**
 * Our history → the Responses `input` array.
 *
 * ⚠️ **Content part names differ from chat completions and are not interchangeable**: `input_text`,
 * `input_image`, `input_file` — and an assistant turn uses `output_text`. Sending a chat-completions
 * part here is a 400 that names the index, not the cause.
 *
 * ⛔ **PDFs must survive this.** The SQEM-149 version of this mapping replaced every non-image
 * attachment with the literal string `[attachment omitted]`, so a connector chat answered about a
 * document it had never seen — the same silent-drop failure SQEM-321 fixed on the other path.
 * `input_file` carries it properly now.
 */
export function toResponsesInput(messages: ChatLikeMessage[], decodeText: TextDecoderFn): any[] {
  return messages.map((msg): any => {
    if (typeof msg.content === 'string') return { role: msg.role, content: msg.content };

    const textType = msg.role === 'assistant' ? 'output_text' : 'input_text';
    const content = msg.content.map((p: any) => {
      if (p.inlineData) {
        const { mimeType, data } = p.inlineData;
        if (mimeType.startsWith('image/')) {
          return { type: 'input_image', image_url: `data:${mimeType};base64,${data}` };
        }
        if (mimeType === 'application/pdf') {
          return { type: 'input_file', filename: 'document.pdf', file_data: `data:application/pdf;base64,${data}` };
        }
        if (mimeType.startsWith('text/')) {
          // ⚠️ `.text`, not the object. The SQEM-149 version passed the whole `{type,text}` object
          // into a string field, so every attached text file reached the model as `[object Object]`.
          return { type: textType, text: decodeText(p.inlineData) };
        }
        return { type: textType, text: `[unsupported attachment: ${mimeType}]` };
      }
      return { type: textType, text: p.text || String(p) };
    });
    return { role: msg.role, content };
  });
}

/**
 * Remote MCP connectors, unchanged from SQEM-149.
 *
 * ⭐ These now sit in the **same** `tools` array as our own function tools. On chat completions the
 * two could not coexist — one field, two writers — which is why SQEM-373 withheld library tools
 * whenever a connector was active. On Responses that restriction simply has no cause any more:
 * OpenAI executes the `mcp` entries itself and hands the `function` ones back to us.
 */
export function connectorResponsesTools(
  connectors: { url: string; name: string; token: string | null; allowedTools: string[] | null }[],
): any[] {
  return connectors.map(c => {
    const t: any = { type: 'mcp', server_label: c.name, server_url: c.url, require_approval: 'never' };
    if (c.token) t.authorization = c.token;
    if (c.allowedTools) t.allowed_tools = c.allowedTools;
    return t;
  });
}

// ── Reading a response ──────────────────────────────────────────────────────

/** The assembled text of a non-streamed response. */
export function readResponsesText(output: any[] | undefined): string {
  return (output || [])
    .filter((i: any) => i?.type === 'message')
    .flatMap((i: any) => (i.content || []).filter((c: any) => c?.type === 'output_text').map((c: any) => c.text))
    .join('');
}

/**
 * Streamed text.
 *
 * ⚠️ The SSE body carries `event:` lines as well as `data:`, but the event name is also inside the
 * JSON as `type` — so the extractor keys off the payload and the `event:` lines can stay ignored, the
 * way `readSSE` already ignores them for every other provider.
 */
export const responsesDelta = (chunk: unknown): string | null => {
  const c = chunk as { type?: string; delta?: string };
  return c?.type === 'response.output_text.delta' ? (c.delta || null) : null;
};

/**
 * Everything the model produced in one round, in order, **verbatim**.
 *
 * ⭐ Built from `response.output_item.done`, which carries each item complete — so unlike OpenAI's
 * chat-completions or Claude's streams there is nothing to reassemble here. `function_call_arguments
 * .delta` exists too and is deliberately ignored: reassembling fragments we are also handed whole is
 * a second code path with the same job and one more way to be wrong.
 *
 * ⛔ **Reasoning items are collected as well, not just function calls.** A reasoning model's next
 * request must carry them back or the call loses the thinking it already paid for — the same class of
 * loss as Gemini's `thoughtSignature` (SQEM-376). Collecting *every* completed item makes that
 * automatic rather than a list of special cases to keep current.
 */
export function createResponsesItemCollector() {
  const items: any[] = [];
  return {
    onChunk(chunk: unknown) {
      const c = chunk as { type?: string; item?: any };
      if (c?.type !== 'response.output_item.done' || !c.item) return;
      items.push(c.item);
    },
    /** Every completed output item, in arrival order. */
    items: () => items,
  };
}

/** The function calls among a set of output items. */
export function readResponsesToolCalls(output: any[] | undefined) {
  return (output || [])
    .filter((i: any) => i?.type === 'function_call' && i?.name)
    .map((i: any) => ({
      id: i.call_id || i.id || '',
      name: i.name as string,
      args: (i.arguments ?? '') as string,
      raw: i as Record<string, unknown>,
    }));
}

/**
 * The items that carry tool results back.
 *
 * ⚠️ Paired by `call_id`, and the **model's own items go back first** — a `function_call_output`
 * whose `function_call` is not in the input is rejected.
 */
export function responsesToolResults(results: { id: string; output: string }[]): any[] {
  return results.map(r => ({ type: 'function_call_output', call_id: r.id, output: r.output }));
}

/**
 * SQEM-572 — the state of a Responses round, read from the same chunks as the text and the items.
 *
 * ⛔ **A Responses stream can fail AFTER a 200.** The HTTP status only says the stream started; a
 * `response.failed` or an `error` event inside it, or a `response.incomplete`, is how OpenAI says the
 * answer did not come. Read only for text deltas and completed items, such a stream ends with empty text,
 * and Chat showed "No content generated." — for every message, with nothing in the logs to say why.
 */
export interface ResponsesRoundState {
  /** The last event type seen — what the log line reports when nothing else explains an empty answer. */
  lastType: string;
  status: 'completed' | 'failed' | 'incomplete' | null;
  /** OpenAI's own message from `response.failed` or `error`. */
  failure: string | null;
  /** `incomplete_details.reason` from `response.incomplete` (e.g. max_output_tokens, content_filter). */
  incomplete: string | null;
}

export function createResponsesStreamWatcher() {
  const s: ResponsesRoundState = { lastType: '', status: null, failure: null, incomplete: null };
  return {
    onChunk(chunk: unknown) {
      const c = chunk as { type?: string; message?: string; code?: string; error?: { message?: string; code?: string }; response?: any };
      if (!c?.type) return;
      s.lastType = c.type;
      if (c.type === 'error') {
        s.failure = c.message || c.error?.message || c.code || c.error?.code || 'unknown error';
      } else if (c.type === 'response.failed') {
        s.status = 'failed';
        s.failure = c.response?.error?.message || c.response?.error?.code || s.failure || 'the response failed';
      } else if (c.type === 'response.incomplete') {
        s.status = 'incomplete';
        s.incomplete = c.response?.incomplete_details?.reason || 'unknown reason';
      } else if (c.type === 'response.completed') {
        s.status = 'completed';
      }
    },
    state: (): ResponsesRoundState => ({ ...s }),
  };
}

/** The same state for a non-streamed round, from the response body. */
export function responsesBodyState(data: any): ResponsesRoundState {
  const status = data?.status === 'failed' || data?.status === 'incomplete' || data?.status === 'completed' ? data.status : null;
  return {
    lastType: '',
    status,
    failure: status === 'failed' ? (data?.error?.message || data?.error?.code || 'the response failed') : null,
    incomplete: status === 'incomplete' ? (data?.incomplete_details?.reason || 'unknown reason') : null,
  };
}

/**
 * Whether a round must be reported as an error, and with which words. `null` = carry on.
 * ⚠️ `incomplete` WITH text is not an error: the text the user got stays, the caller logs the reason.
 */
export function responsesRoundProblem(s: ResponsesRoundState, text: string): string | null {
  if (s.failure) return `OpenAI API error (stream): ${s.failure}`;
  if (s.incomplete && !text) return `OpenAI API error (stream): the answer was cut off before any text (${s.incomplete})`;
  return null;
}
