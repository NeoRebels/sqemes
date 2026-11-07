import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claudeUsage, responsesUsage, geminiUsage, chatCompletionsUsage, addUsage } from '../../supabase/functions/_shared/tokenUsage';
import { MCP_RESULT_MAX_CHARS, toolResultText } from '../../supabase/functions/_shared/mcpClient';

/** SQEM-652/654 — tokens per answer and the cached part, per provider; the result bound at 60,000. */
describe('token usage per provider', () => {
  it('Claude: input with cache reads and writes, the reads as cached; output from message_delta; a whole body', () => {
    expect(claudeUsage({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 5, output_tokens: 1 } } })).toEqual({ input: 155, output: 1, cached: 50, written: 5 });
    expect(claudeUsage({ type: 'message_delta', usage: { output_tokens: 40 } })).toEqual({ input: 0, output: 40, cached: 0 });
    expect(claudeUsage({ type: 'message', usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 } })).toEqual({ input: 9, output: 3, cached: 2, written: 0 });
    expect(claudeUsage({ type: 'content_block_delta' })).toEqual({ input: 0, output: 0, cached: 0 });
  });
  it('OpenAI: response.completed when streamed, the body otherwise, cached from input_tokens_details', () => {
    expect(responsesUsage({ type: 'response.completed', response: { usage: { input_tokens: 900, output_tokens: 80, input_tokens_details: { cached_tokens: 600 } } } })).toEqual({ input: 900, output: 80, cached: 600 });
    expect(responsesUsage({ object: 'response', usage: { input_tokens: 9, output_tokens: 8 } })).toEqual({ input: 9, output: 8, cached: 0 });
    expect(responsesUsage({ type: 'response.output_text.delta', delta: 'x' })).toEqual({ input: 0, output: 0, cached: 0 });
  });
  it('Gemini: usageMetadata, or nothing on a chunk without it', () => {
    expect(geminiUsage({ usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 20, cachedContentTokenCount: 300 } })).toEqual({ input: 500, output: 20, cached: 300 });
    expect(geminiUsage({ candidates: [] })).toBeNull();
  });
  it('chat completions: prompt_tokens_details.cached_tokens, or DeepSeek prompt_cache_hit_tokens', () => {
    expect(chatCompletionsUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 64 } })).toEqual({ input: 100, output: 10, cached: 64 });
    expect(chatCompletionsUsage({ prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 80 })).toEqual({ input: 100, output: 10, cached: 80 });
    expect(chatCompletionsUsage(undefined)).toEqual({ input: 0, output: 0, cached: 0 });
  });
  it('adds up over rounds, and leaves the stats alone when there is nothing', () => {
    const stats: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } = {};
    addUsage(stats, { input: 0, output: 0, cached: 0 });
    addUsage(stats, null);
    expect(stats).toEqual({});
    addUsage(stats, { input: 10, output: 2, cached: 4 });
    addUsage(stats, { input: 5, output: 1, cached: 0 });
    expect(stats).toEqual({ inputTokens: 15, outputTokens: 3, cachedInputTokens: 4 });
    addUsage(stats, { input: 20, output: 0, cached: 0, written: 20 }); // SQEM-654 — Claude's cache writes
    expect(stats).toEqual({ inputTokens: 35, outputTokens: 3, cachedInputTokens: 4, cacheWriteTokens: 20 });
    addUsage(undefined, { input: 1, output: 1, cached: 1 }); // no runtime, no crash
  });
});

describe('SQEM-654 — prompt caching in chat-message', () => {
  const fn = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
  it('stable first, changing last: the date and web lines follow the library rule and the session', () => {
    expect(fn).toMatch(/const stableInstruction = tools \? withLibraryPrompt\(systemInstruction\) : systemInstruction;/);
    expect(fn).toMatch(/const changingInstruction = \[tools && web \? WEB_SEARCH_INSTRUCTION : null, tools && analysisTables\.length \? ANALYSIS_INSTRUCTION : null, timeLine\]\.filter\(Boolean\)\.join\('\\n\\n'\);/);
    expect(fn).toMatch(/const instruction = \[stableInstruction, changingInstruction\]\.filter\(Boolean\)\.join\('\\n\\n'\) \|\| undefined;/);
    // ⛔ the date line is no longer put in FRONT of the session instruction for text answers
    expect(fn).toMatch(/systemInstruction, \/\/ SQEM-654 — without the time line/);
  });
  it('Claude: automatic caching on the request, and a cache point after the stable half', () => {
    const claude = fn.slice(fn.indexOf('async function callClaude'));
    expect(claude).toMatch(/body\.cache_control = \{ type: 'ephemeral' \};/);
    expect(claude).toMatch(/\{ type: 'text', text: systemParts\.stable, cache_control: \{ type: 'ephemeral' \} \}/);
    expect(claude.indexOf('systemParts.stable, cache_control')).toBeLessThan(claude.indexOf('systemParts.changing }'));
  });
  it('Gemini usage is cumulative per round: the last chunk counts, once', () => {
    expect(fn).toMatch(/roundUsage = geminiUsage\(chunk\) \?\? roundUsage;/);
    expect(fn).toMatch(/addUsage\(tools\?\.stats, roundUsage\);/);
  });
});

describe('the result bound', () => {
  it('is 60,000 characters (2026-11-04) and says what was left out', () => {
    expect(MCP_RESULT_MAX_CHARS).toBe(60_000);
    const out = toolResultText({ content: [{ type: 'text', text: 'x'.repeat(70_000) }] });
    expect(out.startsWith('x'.repeat(60_000))).toBe(true);
    expect(out).toMatch(/\[Truncated: the tool returned 70000 characters, only the first 60000 are shown\.\]/);
  });
});
