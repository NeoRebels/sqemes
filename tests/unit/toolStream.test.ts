import { describe, it, expect } from 'vitest';
import {
  createOpenAiToolAccumulator, createClaudeToolAccumulator, createGeminiToolAccumulator,
  readOpenAiToolCalls, openAiAssistantTurn,
  readClaudeToolCalls, claudeAssistantTurn, claudeToolResults,
  readGeminiToolCalls, geminiModelTurn, geminiToolResults,
  parseToolArgs,
} from '../../supabase/functions/_shared/toolStream';
import { readSSE, openAiDelta, claudeDelta } from '../../supabase/functions/_shared/sseStream';

/**
 * SQEM-373 — a tool call assembled out of a token stream.
 *
 * ⚠️ Everything here is the reassembly, which is the half that fails silently: a half-parsed
 * argument string calls the right tool with the wrong input, and the result reads like a model
 * mistake rather than a parser bug.
 */
function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('parseToolArgs', () => {
  it('an empty argument string is {}, not an error', () => {
    // ⛔ `list_personas` takes no parameters and several providers call it with `""`. Throwing here
    // would make the one tool that needs no thought the one that fails.
    expect(parseToolArgs('')).toEqual({});
    expect(parseToolArgs('   ')).toEqual({});
  });

  it('parses an object', () => {
    expect(parseToolArgs('{"query":"invoice"}')).toEqual({ query: 'invoice' });
  });

  it('⚠️ a truncated string degrades to {} rather than throwing', () => {
    // The handler then answers "provide either id or name", which the model can act on. An
    // exception would reach the user as a failed message for something that was retryable.
    expect(parseToolArgs('{"query":"inv')).toEqual({});
    expect(parseToolArgs('[1,2]')).toEqual({});
  });
});

describe('OpenAI — fragments keyed by index', () => {
  it('⛔ concatenates arguments split across chunks', async () => {
    const acc = createOpenAiToolAccumulator();
    const deltas: string[] = [];
    await readSSE(stream(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_templates","arguments":"{\\"que"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\\":\\"invoice\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ), openAiDelta, d => deltas.push(d), c => acc.onChunk(c));

    expect(acc.calls()).toEqual([{ id: 'call_1', name: 'search_templates', args: '{"query":"invoice"}' }]);
    expect(parseToolArgs(acc.calls()[0].args)).toEqual({ query: 'invoice' });
    expect(deltas).toEqual([]); // a tool round emits no text
  });

  it('⛔ keeps two parallel calls apart by index, not by id', () => {
    // The id arrives ONCE, on the first fragment. Keying on it would open a new entry for every
    // nameless fragment and lose the arguments.
    const acc = createOpenAiToolAccumulator();
    acc.onChunk({ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'a', function: { name: 'get_template', arguments: '{"na' } },
      { index: 1, id: 'b', function: { name: 'get_persona', arguments: '{"na' } },
    ] } }] });
    acc.onChunk({ choices: [{ delta: { tool_calls: [
      { index: 1, function: { arguments: 'me":"editor"}' } },
      { index: 0, function: { arguments: 'me":"brief"}' } },
    ] } }] });

    expect(acc.calls()).toEqual([
      { id: 'a', name: 'get_template', args: '{"name":"brief"}' },
      { id: 'b', name: 'get_persona', args: '{"name":"editor"}' },
    ]);
  });

  it('text and a tool call on the same stream do not interfere', async () => {
    const acc = createOpenAiToolAccumulator();
    const deltas: string[] = [];
    const { text } = await readSSE(stream(
      'data: {"choices":[{"delta":{"content":"Let me look. "}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"list_personas","arguments":""}}]}}]}\n\n',
    ), openAiDelta, d => deltas.push(d), c => acc.onChunk(c));

    expect(text).toBe('Let me look. ');
    expect(deltas).toEqual(['Let me look. ']);
    expect(acc.calls()).toHaveLength(1);
  });

  it('ignores a chunk with no tool calls', () => {
    const acc = createOpenAiToolAccumulator();
    acc.onChunk({ choices: [{ delta: { content: 'x' } }] });
    acc.onChunk(null);
    acc.onChunk({});
    expect(acc.calls()).toEqual([]);
  });
});

describe('Claude — name from the block start, arguments from the deltas', () => {
  it('⛔ pairs input_json_delta to its block by index', async () => {
    const acc = createClaudeToolAccumulator();
    const deltas: string[] = [];
    const { text } = await readSSE(stream(
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking."}}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_template"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\":"}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"brief\\"}"}}\n\n',
    ), claudeDelta, d => deltas.push(d), c => acc.onChunk(c));

    expect(text).toBe('Checking.');
    expect(deltas).toEqual(['Checking.']);
    expect(acc.calls()).toEqual([{ id: 'toolu_1', name: 'get_template', args: '{"name":"brief"}' }]);
  });

  it('⚠️ a json delta for a block that was never opened as a tool is dropped', () => {
    // Rather than inventing a nameless call. The text block shares the index space.
    const acc = createClaudeToolAccumulator();
    acc.onChunk({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{}' } });
    expect(acc.calls()).toEqual([]);
  });
});

describe('Gemini — whole calls, no ids', () => {
  it('takes functionCall parts complete and serialises the args', () => {
    const acc = createGeminiToolAccumulator();
    acc.onChunk({ candidates: [{ content: { parts: [{ functionCall: { name: 'get_persona', args: { name: 'editor' } } }] } }] });
    acc.onChunk({ candidates: [{ content: { parts: [{ text: 'ignored here' }] } }] });
    expect(acc.calls()).toHaveLength(1);
    // `toMatchObject`, not `toEqual`: the call also carries `raw`, the verbatim part (SQEM-376).
    expect(acc.calls()[0]).toMatchObject({ id: 'gemini_1', name: 'get_persona', args: '{"name":"editor"}' });
  });

  it('a call with no args serialises to {}', () => {
    const acc = createGeminiToolAccumulator();
    acc.onChunk({ candidates: [{ content: { parts: [{ functionCall: { name: 'list_personas' } }] } }] });
    expect(parseToolArgs(acc.calls()[0].args)).toEqual({});
  });

  it('⛔ SQEM-376 — the thoughtSignature is CAPTURED, not dropped', () => {
    // Gemini's thinking models attach it to the functionCall part and reject the next request
    // outright without it: "Function call is missing a thought_signature in functionCall parts."
    // It is opaque, so there is nothing to reconstruct it from.
    const part = { functionCall: { name: 'search_templates', args: { query: 'x' } }, thoughtSignature: 'Ct8BAd' };
    const acc = createGeminiToolAccumulator();
    acc.onChunk({ candidates: [{ content: { parts: [part] } }] });
    expect(acc.calls()[0].raw).toEqual(part);
  });

  it('…from a non-streamed response too', () => {
    const part = { functionCall: { name: 'get_persona', args: {} }, thoughtSignature: 'sig' };
    expect(readGeminiToolCalls([part])[0].raw).toEqual(part);
  });
});

describe('the non-streaming reads — the funded and connector paths', () => {
  it('⛔ OpenAI tool calls are read from a plain response too', () => {
    // Without this, tool calling would have been a BYOK-only feature by accident: funded chats do
    // not stream (SQEM-372), so they never touch the accumulator.
    expect(readOpenAiToolCalls({
      tool_calls: [{ id: 'c1', function: { name: 'search_templates', arguments: '{"query":"x"}' } }],
    })).toEqual([{ id: 'c1', name: 'search_templates', args: '{"query":"x"}' }]);
    expect(readOpenAiToolCalls({})).toEqual([]);
    expect(readOpenAiToolCalls(undefined)).toEqual([]);
  });

  it('Claude tool_use blocks are read from a plain response', () => {
    expect(readClaudeToolCalls([
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'get_persona', input: { name: 'editor' } },
    ])).toEqual([{ id: 't1', name: 'get_persona', args: '{"name":"editor"}' }]);
    expect(readClaudeToolCalls(undefined)).toEqual([]);
  });

  it('Gemini functionCall parts are read from a plain response', () => {
    expect(readGeminiToolCalls([{ functionCall: { name: 'list_personas', args: {} } }])[0])
      .toMatchObject({ id: 'gemini_1', name: 'list_personas', args: '{}' });
  });
});

describe('the turns that go back', () => {
  const call = { id: 'c1', name: 'get_template', args: '{"name":"brief"}' };

  it('⚠️ OpenAI: content is null, never an empty string', () => {
    // An empty string is a valid assistant message, and some compatible endpoints then treat the
    // turn as a spoken reply and refuse the `tool` messages that follow.
    const turn = openAiAssistantTurn('', [call]) as any;
    expect(turn.content).toBeNull();
    expect(turn.tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'get_template', arguments: '{"name":"brief"}' } });
  });

  it('OpenAI: text said before the call is carried back with it', () => {
    expect((openAiAssistantTurn('One moment.', [call]) as any).content).toBe('One moment.');
  });

  it('⛔ Claude: an empty text block is omitted — the API rejects it', () => {
    const turn = claudeAssistantTurn('', [call]) as any;
    expect(turn.content).toHaveLength(1);
    expect(turn.content[0]).toEqual({ type: 'tool_use', id: 'c1', name: 'get_template', input: { name: 'brief' } });

    const spoken = claudeAssistantTurn('Checking.', [call]) as any;
    expect(spoken.content[0]).toEqual({ type: 'text', text: 'Checking.' });
    expect(spoken.content).toHaveLength(2);
  });

  it('⛔ Claude: every result goes in ONE user turn', () => {
    // A turn that answers only some of the tool_use blocks before it is rejected.
    const turn = claudeToolResults([{ id: 'a', output: '1' }, { id: 'b', output: '2' }]) as any;
    expect(turn.role).toBe('user');
    expect(turn.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '1' },
      { type: 'tool_result', tool_use_id: 'b', content: '2' },
    ]);
  });

  it('⚠️ Gemini: results pair by NAME and the response must be an object', () => {
    const turn = geminiToolResults([{ name: 'get_template', output: '{}' }]) as any;
    expect(turn.parts[0].functionResponse.name).toBe('get_template');
    expect(typeof turn.parts[0].functionResponse.response).toBe('object');
  });

  it('Gemini: the model turn carries the call back as a part', () => {
    const turn = geminiModelTurn('', [call]) as any;
    expect(turn.role).toBe('model');
    expect(turn.parts).toEqual([{ functionCall: { name: 'get_template', args: { name: 'brief' } } }]);
  });

  it('⛔ SQEM-376 — a captured Gemini part goes back BYTE-FOR-BYTE, signature included', () => {
    // Rebuilding it from name + args looks equivalent and is not: the signature cannot be
    // regenerated, and its absence is a hard 400 rather than a degradation.
    const raw = { functionCall: { name: 'get_template', args: { name: 'brief' } }, thoughtSignature: 'Ct8BAd' };
    const turn = geminiModelTurn('', [{ ...call, raw }]) as any;
    expect(turn.parts).toEqual([raw]);
    expect(turn.parts[0].thoughtSignature).toBe('Ct8BAd');
  });

  it('a call with no captured part is still rebuilt', () => {
    // The fallback stays for a hand-written call or a provider that stops sending one.
    expect((geminiModelTurn('', [call]) as any).parts[0]).toHaveProperty('functionCall');
  });
});
