import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  toResponsesInput, connectorResponsesTools, responsesDelta,
  createResponsesItemCollector, readResponsesText, readResponsesToolCalls, responsesToolResults,
} from '../../supabase/functions/_shared/openaiResponses';
import { toResponsesTools, LIBRARY_TOOLS } from '../../supabase/functions/_shared/libraryTools';
import { readSSE } from '../../supabase/functions/_shared/sseStream';

/**
 * SQEM-377 — OpenAI over `/v1/responses`, the one path for plain chat, connectors and tools.
 *
 * ⚠️ Every shape here differs from chat completions by a NAME, not a structure — `input_text` vs
 * `text`, `input_file` vs `file`, flat tools vs nested. A wrong name is a 400 that points at an
 * index. These tests pin the names, because nothing else can.
 */
const decodeText = (d: { mimeType: string; data: string }) =>
  Buffer.from(d.data, 'base64').toString('utf8');

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('toResponsesInput — the part names', () => {
  it('a plain string turn passes through unchanged', () => {
    expect(toResponsesInput([{ role: 'user', content: 'hi' }], decodeText))
      .toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('user text is input_text, assistant text is output_text', () => {
    // ⚠️ Not interchangeable: an assistant turn carrying `input_text` is rejected.
    const [u] = toResponsesInput([{ role: 'user', content: [{ text: 'a' }] }], decodeText) as any[];
    const [a] = toResponsesInput([{ role: 'assistant', content: [{ text: 'b' }] }], decodeText) as any[];
    expect(u.content[0]).toEqual({ type: 'input_text', text: 'a' });
    expect(a.content[0]).toEqual({ type: 'output_text', text: 'b' });
  });

  it('an image becomes input_image with a data url', () => {
    const [m] = toResponsesInput([{
      role: 'user', content: [{ inlineData: { mimeType: 'image/png', data: 'AAA' } }],
    }], decodeText) as any[];
    expect(m.content[0]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,AAA' });
  });

  it('⛔ a PDF survives as input_file — it used to be thrown away', () => {
    // The SQEM-149 mapping replaced every non-image attachment with the literal "[attachment
    // omitted]", so a connector chat answered about a document it had never seen. Same silent-drop
    // failure SQEM-321 fixed on the other path.
    const [m] = toResponsesInput([{
      role: 'user', content: [{ inlineData: { mimeType: 'application/pdf', data: 'JVBER' } }],
    }], decodeText) as any[];
    expect(m.content[0]).toEqual({
      type: 'input_file', filename: 'document.pdf', file_data: 'data:application/pdf;base64,JVBER',
    });
    expect(JSON.stringify(m)).not.toContain('omitted');
  });

  it('⛔ a text attachment reaches the model as TEXT, not as [object Object]', () => {
    // The SQEM-149 version passed the whole `{type,text}` object into a string field.
    const data = Buffer.from('hello file', 'utf8').toString('base64');
    const [m] = toResponsesInput([{
      role: 'user', content: [{ inlineData: { mimeType: 'text/plain', data } }],
    }], decodeText) as any[];
    expect(m.content[0]).toEqual({ type: 'input_text', text: 'hello file' });
  });

  it('an unsupported attachment says so instead of vanishing', () => {
    const [m] = toResponsesInput([{
      role: 'user', content: [{ inlineData: { mimeType: 'application/zip', data: 'x' } }],
    }], decodeText) as any[];
    expect(m.content[0].text).toMatch(/unsupported attachment: application\/zip/);
  });
});

describe('the tools array', () => {
  it('⛔ a function tool is FLAT here, not nested under `function`', () => {
    const [t] = toResponsesTools(LIBRARY_TOOLS) as any[];
    expect(t).toMatchObject({ type: 'function', name: 'search_templates' });
    expect(t).not.toHaveProperty('function');
    expect(t).toHaveProperty('parameters');
  });

  it('⛔ strict is explicitly false', () => {
    // Strict mode demands every property required and `additionalProperties: false`; our schemas
    // have optional parameters by design (`get_template` takes either name or id). A default that
    // flipped to strict would reject the whole request and blame the schema.
    for (const t of toResponsesTools(LIBRARY_TOOLS) as any[]) expect(t.strict).toBe(false);
  });

  it('⭐ connectors and function tools coexist in ONE array', () => {
    // The reason SQEM-373's exclusion could be lifted for OpenAI.
    const combined = [
      ...connectorResponsesTools([{ url: 'https://x', name: 'c_1', token: 't', allowedTools: ['a'] }]),
      ...toResponsesTools(LIBRARY_TOOLS),
    ] as any[];
    expect(combined[0]).toMatchObject({ type: 'mcp', server_label: 'c_1', server_url: 'https://x', authorization: 't', allowed_tools: ['a'] });
    expect(combined.filter(t => t.type === 'function')).toHaveLength(LIBRARY_TOOLS.length);
  });

  it('a connector without a token carries no authorization key', () => {
    const [t] = connectorResponsesTools([{ url: 'https://x', name: 'c_1', token: null, allowedTools: null }]) as any[];
    expect(t).not.toHaveProperty('authorization');
    expect(t).not.toHaveProperty('allowed_tools');
  });
});

describe('reading a response', () => {
  it('text is assembled from output_text parts of message items', () => {
    expect(readResponsesText([
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'Hel' }, { type: 'refusal', refusal: 'no' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'lo' }] },
    ])).toBe('Hello');
    expect(readResponsesText(undefined)).toBe('');
  });

  it('function calls are read with their call_id', () => {
    const calls = readResponsesToolCalls([
      { type: 'reasoning', id: 'rs_1' },
      { type: 'function_call', call_id: 'call_1', name: 'get_persona', arguments: '{"name":"editor"}' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'call_1', name: 'get_persona', args: '{"name":"editor"}' });
  });

  it('⛔ the tool result pairs by call_id', () => {
    expect(responsesToolResults([{ id: 'call_1', output: '{}' }]))
      .toEqual([{ type: 'function_call_output', call_id: 'call_1', output: '{}' }]);
  });
});

describe('streaming', () => {
  it('text arrives on response.output_text.delta and nothing else', () => {
    expect(responsesDelta({ type: 'response.output_text.delta', delta: 'Hel' })).toBe('Hel');
    // Every other event rides the same stream and must contribute no text.
    for (const t of ['response.created', 'response.output_item.added', 'response.completed', 'response.function_call_arguments.delta']) {
      expect(responsesDelta({ type: t, delta: 'IGNORE' })).toBeNull();
    }
    expect(responsesDelta(null)).toBeNull();
  });

  it('⭐ items arrive COMPLETE — nothing to reassemble', () => {
    // `response.output_item.done` carries the whole item, which is why this provider needs no
    // fragment logic even though `function_call_arguments.delta` also exists.
    const c = createResponsesItemCollector();
    c.onChunk({ type: 'response.output_item.added', item: { type: 'function_call', name: 'x' } });
    c.onChunk({ type: 'response.function_call_arguments.delta', delta: '{"que' });
    c.onChunk({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'search_templates', arguments: '{"query":"invoice"}' } });
    expect(c.items()).toEqual([
      { type: 'function_call', call_id: 'call_1', name: 'search_templates', arguments: '{"query":"invoice"}' },
    ]);
  });

  it('⛔ EVERY completed item is collected, reasoning included', () => {
    // A reasoning model that does not get its own reasoning back loses the thinking it already
    // charged for — the same class of loss as Gemini's thoughtSignature (SQEM-376). Collecting every
    // item makes that automatic instead of a list of special cases.
    const c = createResponsesItemCollector();
    c.onChunk({ type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'xx' } });
    c.onChunk({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'n', arguments: '{}' } });
    expect(c.items().map((i: any) => i.type)).toEqual(['reasoning', 'function_call']);
  });

  it('text and a tool call on one stream do not interfere', async () => {
    const c = createResponsesItemCollector();
    const deltas: string[] = [];
    const { text } = await readSSE(stream(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Looking. "}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"list_personas","arguments":"{}"}}\n\n',
    ), responsesDelta, d => deltas.push(d), chunk => c.onChunk(chunk));

    expect(text).toBe('Looking. ');
    expect(deltas).toEqual(['Looking. ']);
    expect(readResponsesToolCalls(c.items())).toHaveLength(1);
  });
});

describe('SQEM-377 — the wiring, and the twin that was removed', () => {
  const CHAT_FN = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('⛔ there is no chat-completions path for OpenAI any more', () => {
    // The whole point: three OpenAI paths became one. A `callOpenAI` reappearing here is the twin
    // coming back.
    expect(CHAT_FN).not.toContain('api.openai.com/v1/chat/completions');
    expect(CHAT_FN).not.toMatch(/async function callOpenAI\(/);
    expect(CHAT_FN).toContain('api.openai.com/v1/responses');
  });

  it('⛔ every output item is echoed back before the results', () => {
    // A `function_call_output` whose `function_call` is not in the input is rejected.
    const fn = CHAT_FN.slice(CHAT_FN.indexOf('async function callOpenAIResponses'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body.indexOf('input.push(...items)')).toBeGreaterThan(-1);
    expect(body.indexOf('input.push(...items)')).toBeLessThan(body.indexOf('responsesToolResults'));
  });

  it('the SQEM-375 fallback survives on this path too', () => {
    // Responses fixes OpenAI's reasoning models, not every model a workspace might point at.
    const fn = CHAT_FN.slice(CHAT_FN.indexOf('async function callOpenAIResponses'));
    expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/toolsWereRefused\(response\.status, errText\)/);
  });
});
