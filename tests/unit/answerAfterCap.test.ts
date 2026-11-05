import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stopReasonOf } from '../../supabase/functions/_shared/sseStream';
import { noAnswerText, type ToolStats } from '../../supabase/functions/_shared/libraryTools';
import { en, de } from './i18nText';

/**
 * SQEM-637 — A customer, 2026-11-03, 15:41 UTC: Gemini with Chatarmin, 6 rounds, 14 calls, then the cap —
 * and the forced last answer was empty ("No content generated"). Nothing recorded why.
 */
const stats = (cappedAt: number | null): ToolStats => ({
  rounds: 6, calls: 14, byTool: {}, cappedAt, cappedBy: cappedAt ? 'rounds' : null,
  toolsRefused: false, refusedConnectors: [], stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0,
});

describe('SQEM-637 — why a provider stopped is read in all three shapes', () => {
  it('Gemini, Claude (body and stream), OpenAI-shaped', () => {
    expect(stopReasonOf({ candidates: [{ finishReason: 'UNEXPECTED_TOOL_CALL' }] })).toBe('UNEXPECTED_TOOL_CALL');
    expect(stopReasonOf({ stop_reason: 'end_turn' })).toBe('end_turn');
    expect(stopReasonOf({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })).toBe('tool_use');
    expect(stopReasonOf({ choices: [{ finish_reason: 'length' }] })).toBe('length');
  });

  it('a chunk that says nothing is null, never a guess', () => {
    expect(stopReasonOf({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })).toBeNull();
    expect(stopReasonOf({ choices: [{ finish_reason: null }] })).toBeNull();
    expect(stopReasonOf(null)).toBeNull();
  });
});

describe('SQEM-637 — an empty answer after the cap says what to do', () => {
  it('after a cap: its own text; otherwise the old one', () => {
    expect(noAnswerText(stats(6))).toBe(en.chat_tool_cap_empty);
    expect(noAnswerText(stats(6), 'de')).toBe(de.chat_tool_cap_empty);
    expect(noAnswerText(stats(null))).toBe(en.chat_no_content);
    expect(noAnswerText(null)).toBe(en.chat_no_content);
    expect(de.chat_tool_cap_empty).not.toBe(en.chat_tool_cap_empty);
  });

  it('every provider path uses it, and none says "no content" on its own any more', () => {
    const fn = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect([...fn.matchAll(/noAnswerText\(tools\?\.stats, locale\)/g)]).toHaveLength(4);
    expect(fn).not.toMatch(/answer \|\| m\.chat_no_content/);
  });

  it('the stop reason is recorded in every provider path', () => {
    const fn = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    // Gemini and Claude: stream + body; OpenAI-shaped: through readOpenAiRound; Responses: the round state.
    expect([...fn.matchAll(/tools\.stats\.stopReason = stopReasonOf\((chunk|data)\)/g)].length).toBeGreaterThanOrEqual(4);
    expect(fn).toMatch(/tools\.stats\.stopReason = round\.incomplete \?\? round\.status/);
    expect(fn).toMatch(/tools \? \(r\) => \{ tools\.stats\.stopReason = r; \} : undefined/);
  });
});
