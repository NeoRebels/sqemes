import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClaudeToolAccumulator, createOpenAiToolAccumulator, isTruncatedArgs } from '../../supabase/functions/_shared/toolStream';
import { runToolCall, truncatedNotice, type ToolRuntime } from '../../supabase/functions/_shared/libraryTools';
import { de } from './i18nText';
import { OUTPUT_LIMIT, outputLimit } from '../../supabase/functions/_shared/outputLimits';
import { AVAILABLE_MODELS } from '../../constants';
import { isImageModel } from '../../lib/enabledModels';

/**
 * SQEM-616 — a tool call cut off at the output limit is caught, not executed, and said.
 * 2026-10-28: two `upload_file` attempts of a 17 KB product list, an empty answer.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const runtime = (): ToolRuntime => ({
  definitions: [],
  maxRounds: 6,
  deadline: Date.now() + 1e6,
  stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [], stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0 },
  execute: vi.fn(async () => 'done'),
});

describe('isTruncatedArgs', () => {
  it('complete JSON and no arguments are not truncated; a cut-off object is', () => {
    expect(isTruncatedArgs('')).toBe(false);
    expect(isTruncatedArgs('{}')).toBe(false);
    expect(isTruncatedArgs('{"name":"a.md","content":"x"}')).toBe(false);
    expect(isTruncatedArgs('{"name":"produkte.md","content":"# Produkte\\n\\n**Example')).toBe(true);
  });
});

describe('the stream that broke off', () => {
  it('Claude: tool_use opened, JSON deltas, then max_tokens — the assembled call is recognised as truncated', () => {
    const acc = createClaudeToolAccumulator();
    acc.onChunk({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'upload_file' } });
    acc.onChunk({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"produkte.md",' } });
    acc.onChunk({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"content":"# Example GmbH\\n\\n## Produkte' } });
    acc.onChunk({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } });
    const [call] = acc.calls();
    expect(call.name).toBe('upload_file');
    expect(isTruncatedArgs(call.args)).toBe(true);
  });

  it('OpenAI-compatible: the same shape with finish_reason length', () => {
    const acc = createOpenAiToolAccumulator();
    acc.onChunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'upload_file', arguments: '{"name":"a.md","content":"lang' } }] } }] });
    acc.onChunk({ choices: [{ delta: {}, finish_reason: 'length' }] });
    expect(isTruncatedArgs(acc.calls()[0].args)).toBe(true);
  });
});

describe('runToolCall', () => {
  it('⛔ a truncated call is NOT executed; the model is told why, and it is counted', async () => {
    const tools = runtime();
    const out = await runToolCall(tools, { name: 'upload_file', args: '{"name":"a.md","content":"abc' });
    expect(tools.execute).not.toHaveBeenCalled();
    expect(out).toMatch(/cut off at the output limit/);
    expect(out).toMatch(/NOT carried out and nothing changed/);
    expect(tools.stats.truncated).toEqual({ upload_file: 1 });
  });

  it('a complete call runs as before, with parsed arguments', async () => {
    const tools = runtime();
    expect(await runToolCall(tools, { name: 'list_files', args: '' })).toBe('done');
    expect(await runToolCall(tools, { name: 'upload_file', args: '{"name":"a.md","content":"x"}' })).toBe('done');
    expect(tools.execute).toHaveBeenLastCalledWith('upload_file', { name: 'a.md', content: 'x' });
    expect(tools.stats.truncated).toEqual({});
  });
});

describe('the reply says so', () => {
  it('nothing when no call was cut off; a line naming the tool when one was, in the person\'s language', () => {
    const tools = runtime();
    expect(truncatedNotice(tools.stats, 'de')).toBe('');
    tools.stats.truncated.upload_file = 2;
    const line = truncatedNotice(tools.stats, 'de');
    expect(line).toContain(de.chat_tool_truncated.replace('{tools}', 'upload_file'));
    expect(line.startsWith('\n\n---\n_')).toBe(true);
  });
});

describe('wiring in chat-message', () => {
  const src = read('supabase/functions/chat-message/index.ts');
  it('every provider branch runs calls through runToolCall — none parses and executes directly', () => {
    expect(src.match(/await runToolCall\(activeTools, call\)/g)).toHaveLength(4);
    expect(src).not.toMatch(/activeTools\.execute\(/);
  });
  it('the notice is appended and the case is logged', () => {
    expect(src).toMatch(/if \(tools\) result \+= truncatedNotice\(tools\.stats, locale\);/);
    expect(src).toMatch(/Object\.keys\(tools\.stats\.truncated\)\.length > 0/);
  });
  it('every branch sends the limit decided in outputLimits.ts', () => {
    expect(src).toMatch(/max_tokens: OUTPUT_LIMIT\.claude,/);
    expect(src).toMatch(/generationConfig\.maxOutputTokens = OUTPUT_LIMIT\.gemini;/);
    expect(src).toMatch(/max_output_tokens: OUTPUT_LIMIT\.openai/);
    expect(src).toMatch(/const limit = outputLimit\(provider\);\s*if \(limit\) body\.max_tokens = limit;/);
    expect(src).not.toMatch(/max_tokens: 8192/);
  });
});

describe('SQEM-616 — an output limit per provider, inside what each documents', () => {
  // The documented maxima (2026-10-28); a value above Claude's is a 400, so this is not cosmetic.
  const DOCUMENTED_MAX: Record<string, number> = { claude: 128_000, openai: 128_000, gemini: 65_536, deepseek: 393_216 };

  it('every provider of an offered text model has a decision — a number or a deliberate null', () => {
    const textProviders = new Set(AVAILABLE_MODELS.filter(x => !isImageModel(x.id)).map(x => x.provider));
    for (const p of textProviders) expect(Object.keys(OUTPUT_LIMIT), p).toContain(p);
    expect(Object.keys(OUTPUT_LIMIT)).toContain('openrouter'); // user-added models
  });

  it('the numbers stay inside the documented maxima; DeepSeek no longer runs on its 8K default', () => {
    for (const [p, max] of Object.entries(DOCUMENTED_MAX)) {
      const v = OUTPUT_LIMIT[p as keyof typeof OUTPUT_LIMIT];
      expect(v, p).not.toBeNull();
      expect(v as number, p).toBeLessThanOrEqual(max);
    }
    expect(OUTPUT_LIMIT.deepseek).toBeGreaterThan(8_192);
    expect(OUTPUT_LIMIT.claude).toBeGreaterThan(8_192);
  });

  it('Mistral, Grok and OpenRouter send nothing on purpose (context-bound 400 / default suffices / depends on the model)', () => {
    expect([OUTPUT_LIMIT.mistral, OUTPUT_LIMIT.grok, OUTPUT_LIMIT.openrouter]).toEqual([null, null, null]);
    expect(outputLimit('mistral')).toBeNull();
    expect(outputLimit('deepseek')).toBe(64_000);
    expect(outputLimit('something-new')).toBeNull();
  });
});
