import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-435 — connector turns stream.
 *
 * ⛔ **This file is the safety of that change, not documentation of it.** Streaming with
 * `mcp_servers` is only safe because four readers are strict about the event types they accept: the
 * provider's own remote tool calls arrive on the same stream as the text, and a loose filter would
 * either print them as text or hand them to `activeTools.execute`, where the name does not resolve.
 *
 * Loosen any one of these — a `startsWith`, a truthy check, a "just take `.text` wherever you find
 * it" — and the failure is a wrong answer, not an exception. That is why they are pinned here, in one
 * place, with the line that depends on them.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const CHAT = read('supabase/functions/chat-message/index.ts');
const SSE = read('supabase/functions/_shared/sseStream.ts');
const TOOLS = read('supabase/functions/_shared/toolStream.ts');
const RESPONSES = read('supabase/functions/_shared/openaiResponses.ts');

describe('SQEM-435 — streaming with connectors', () => {
  it('⭐ connectors no longer switch streaming off; funded still does', () => {
    expect(CHAT).toMatch(/const streams = !funded;/);
    expect(CHAT).not.toMatch(/const streams = !funded && !connectors\?\.length/);
  });

  it('⛔ Claude: only text_delta reaches the stream', () => {
    // ⚠️ Cut on a line-start `};` — the cast inside the function ends with `};` too, and slicing on
    // the first one produced a "body" that stopped before the guards it is meant to check.
    const fn = SSE.slice(SSE.indexOf('export const claudeDelta'));
    const body = fn.slice(0, fn.indexOf('\n};'));
    expect(body).toMatch(/c\?\.type !== 'content_block_delta'/);
    expect(body).toMatch(/c\.delta\?\.type !== 'text_delta'/);
  });

  it('⛔ Claude: the accumulator opens tool_use blocks only, and drops orphan deltas', () => {
    // An `mcp_tool_use` block is never opened, so its `input_json_delta`s find no entry. Dropping
    // them is explicit — without that the arguments of a remote call would be appended to whichever
    // of our calls shared the index.
    expect(TOOLS).toMatch(/c\?\.type === 'content_block_start' && c\.content_block\?\.type === 'tool_use'/);
    expect(TOOLS).toMatch(/if \(entry\) entry\.args \+= c\.delta\.partial_json/);
  });

  it('⛔ OpenAI: only response.output_text.delta reaches the stream', () => {
    expect(RESPONSES).toMatch(/c\?\.type === 'response\.output_text\.delta'/);
  });

  it('⛔ OpenAI: only function_call items become our tool calls', () => {
    expect(RESPONSES).toMatch(/\.filter\(\(i: any\) => i\?\.type === 'function_call' && i\?\.name\)/);
  });

  it('⛔ none of the four filters is a loose match', () => {
    // The specific looseness that would break this: matching a prefix or a substring, which is what
    // `mcp_tool_use` and `response.mcp_call.*` would slip through.
    for (const [name, src] of [['sseStream', SSE], ['toolStream', TOOLS], ['openaiResponses', RESPONSES]] as const) {
      expect(src, name).not.toMatch(/type\?\.startsWith\(|type\.includes\(/);
    }
  });

  it('⚠️ the longer connector timeout stays — streaming does not make the calls faster', () => {
    expect(CHAT).toMatch(/providerTimeoutMs\(\{ connectors: !!connectors\?\.length/);
  });
});
