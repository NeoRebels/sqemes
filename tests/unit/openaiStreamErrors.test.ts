import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createResponsesStreamWatcher, responsesBodyState, responsesRoundProblem,
} from '../../supabase/functions/_shared/openaiResponses';

/**
 * SQEM-572 — a Responses stream can fail after its 200. Read only for text deltas, it ended empty and
 * Chat showed "No content generated.".
 */
const run = (events: unknown[]) => { const w = createResponsesStreamWatcher(); events.forEach(e => w.onChunk(e)); return w.state(); };

describe('the round state, from the stream', () => {
  it('a normal answer: completed, no problem', () => {
    const s = run([{ type: 'response.created' }, { type: 'response.output_text.delta', delta: 'Hi' }, { type: 'response.completed', response: {} }]);
    expect(s.status).toBe('completed');
    expect(responsesRoundProblem(s, 'Hi')).toBeNull();
  });

  it('⛔ response.failed becomes an error with OpenAI’s own message', () => {
    const s = run([{ type: 'response.created' }, { type: 'response.failed', response: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for gpt-6' } } }]);
    expect(responsesRoundProblem(s, '')).toBe('OpenAI API error (stream): Rate limit reached for gpt-6');
  });

  it('⛔ an error event becomes an error, even with some text already streamed', () => {
    const s = run([{ type: 'response.output_text.delta', delta: 'Hal' }, { type: 'error', message: 'Internal server error' }]);
    expect(responsesRoundProblem(s, 'Hal')).toBe('OpenAI API error (stream): Internal server error');
  });

  it('incomplete WITHOUT text is an error with the reason; WITH text the text stays', () => {
    const s = run([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }]);
    expect(responsesRoundProblem(s, '')).toMatch(/cut off before any text \(max_output_tokens\)/);
    expect(responsesRoundProblem(s, 'partial answer')).toBeNull();
  });

  it('events it does not know change nothing', () => {
    const s = run([{ type: 'response.reasoning_summary_text.delta', delta: 'x' }, { type: 'response.output_item.done', item: { type: 'reasoning' } }, {}, null]);
    expect(s.status).toBeNull();
    expect(s.lastType).toBe('response.output_item.done');
    expect(responsesRoundProblem(s, '')).toBeNull();
  });
});

describe('the round state, from a non-streamed body', () => {
  it('failed and incomplete bodies are read the same way', () => {
    expect(responsesRoundProblem(responsesBodyState({ status: 'failed', error: { message: 'boom' } }), '')).toBe('OpenAI API error (stream): boom');
    expect(responsesRoundProblem(responsesBodyState({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }), '')).toMatch(/content_filter/);
    expect(responsesRoundProblem(responsesBodyState({ status: 'completed' }), 'ok')).toBeNull();
  });
});

describe('wiring in chat-message', () => {
  const fn = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');
  it('the watcher reads the same chunks as the collector, and a problem is thrown before the answer is used', () => {
    expect(fn).toMatch(/\(chunk\) => \{ collector\.onChunk\(chunk\); watcher\.onChunk\(chunk\); \}/);
    expect(fn).toMatch(/round = responsesBodyState\(data\);/);
    expect(fn.indexOf('const problem = responsesRoundProblem(round, text);')).toBeLessThan(fn.indexOf('    answer += text;\n\n    const toolCalls = activeTools ? readResponsesToolCalls(items)'));
    expect(fn).toMatch(/if \(problem\) \{[\s\S]{0,200}throw new Error\(problem\);/);
  });
});
