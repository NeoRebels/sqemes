import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  advanceToolRound, countNativeConnectorCalls, isLibraryOnlyRound, MAX_TOOL_ROUNDS, runToolCall, callKey, type ToolRuntime,
} from '../../supabase/functions/_shared/libraryTools';

/**
 * SQEM-648 — Chief of Staff, „Alles“, 2026-11-04 06:43 UTC (GPT-6 Luna, own key): 6 rounds, 19 calls,
 * all of them library lookups (search 9, read_context_file 6, get_template 4), 4 connectors attached —
 * the cap fired before any system was asked. Library-only rounds got their own guard (648); SQEM-650
 * replaced both guards with loop detection and one emergency cap.
 */
const runtime = (maxRounds = MAX_TOOL_ROUNDS): ToolRuntime => ({
  definitions: [], maxRounds, deadline: Number.MAX_SAFE_INTEGER,
  execute: async (name, args) => `result of ${name} ${JSON.stringify(args)}`,
  stats: {
    rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [],
    stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0,
  },
});

/** Run rounds until the loop must answer; returns how many rounds of work were allowed. */
function advance(rt: ToolRuntime | null, names: string[]): ToolRuntime | null {
  return rt && !rt.final ? advanceToolRound(rt, names) : null;
}

describe('SQEM-648 — which rounds are preparation', () => {
  it('only read-only library tools make a library round; writes and connectors are work', () => {
    expect(isLibraryOnlyRound(['search_templates', 'get_template', 'read_context_file'])).toBe(true);
    expect(isLibraryOnlyRound(['list_personas', 'get_persona'])).toBe(true);
    expect(isLibraryOnlyRound(['list_templates', 'list_files', 'download_skill'])).toBe(true);
    expect(isLibraryOnlyRound(['upload_file'])).toBe(false);
    expect(isLibraryOnlyRound(['get_template', 'mcp0__list_events'])).toBe(false);
    expect(isLibraryOnlyRound(['web_search'])).toBe(false);
    expect(isLibraryOnlyRound(['update_template'])).toBe(false);
    expect(isLibraryOnlyRound([])).toBe(false);
  });

  it('native connector calls are counted in both providers\' shapes', () => {
    expect(countNativeConnectorCalls([{ type: 'mcp_list_tools' }, { type: 'mcp_call' }, { type: 'mcp_call' }, { type: 'function_call' }])).toBe(2);
    expect(countNativeConnectorCalls([{ type: 'text' }, { type: 'mcp_tool_use' }, { type: 'mcp_tool_result' }])).toBe(1);
    expect(countNativeConnectorCalls([undefined])).toBe(0);
    expect(countNativeConnectorCalls(null)).toBe(0);
  });
});

describe('SQEM-650 — the emergency cap replaces the guards of SQEM-648', () => {
  it('the Chief of Staff case: library rounds and rounds of work no longer stop honest work', () => {
    let rt: ToolRuntime | null = runtime();
    for (let i = 0; i < 10; i++) rt = advance(rt, ['search_templates', 'get_template']);
    for (let i = 0; i < 10; i++) rt = advance(rt, ['mcp0__list_events']);
    expect(rt?.final).toBeFalsy();
    expect(rt?.stats).toMatchObject({ rounds: 20, libraryRounds: 10, cappedAt: null });
  });

  it('a loop that varies its arguments still ends, at MAX_TOOL_ROUNDS', () => {
    expect(MAX_TOOL_ROUNDS).toBe(40);
    let rt: ToolRuntime | null = runtime();
    for (let i = 0; i < MAX_TOOL_ROUNDS - 1; i++) rt = advance(rt, ['search_templates']);
    expect(rt?.final).toBeFalsy();
    rt = advance(rt, ['search_templates']);
    expect(rt?.final).toBe(true);
    expect(rt?.stats).toMatchObject({ cappedAt: MAX_TOOL_ROUNDS, cappedBy: 'rounds', libraryRounds: MAX_TOOL_ROUNDS });
    expect(advance(rt, ['search_templates'])).toBeNull();
  });

  it('a round in which the provider ran a connector itself is work, even if it also loaded a playbook', () => {
    const rt = runtime();
    rt.stats.nativeConnectorCalls = 2;
    advanceToolRound(rt, ['get_template']);
    expect(rt.stats.libraryRounds).toBe(0);
    advanceToolRound(rt, ['get_template']); // no new native call since → preparation again
    expect(rt.stats.libraryRounds).toBe(1);
  });

  it('the deadline still ends everything when the chain cannot go on', () => {
    const late = runtime();
    late.deadline = 0;
    expect(advanceToolRound(late, ['get_template'], () => 1)?.final).toBe(true);
    expect(late.stats.cappedBy).toBe('time');
  });

  it('every provider loop reports the names of the calls it ran', () => {
    const chat = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect([...chat.matchAll(/activeTools = advanceToolRound\(activeTools, toolCalls\.map\(c => c\.name\)\);/g)]).toHaveLength(4);
    expect(chat).not.toMatch(/^function advanceToolRound/m);
    expect([...chat.matchAll(/countNativeConnectorCalls\(/g)].length).toBeGreaterThanOrEqual(3); // Responses, Claude stream + body
    expect(chat).toMatch(/connectorsOffered: connectors\?\.length \?\? 0/);
  });
});

describe('SQEM-650 — the same call again is the loop', () => {
  const call = (args: string) => ({ name: 'mcp0__list_events', args });

  it('two calls are the same whatever the order of their keys', () => {
    expect(callKey('t', '{"a":1,"b":{"y":2,"x":1}}')).toBe(callKey('t', '{"b":{"x":1,"y":2},"a":1}'));
    expect(callKey('t', '{"a":1}')).not.toBe(callKey('t', '{"a":2}'));
    expect(callKey('t', '{"a":1}')).not.toBe(callKey('u', '{"a":1}'));
  });

  it('third time: the earlier result and a note, not run again; fourth: the next round is the answer', async () => {
    let runs = 0;
    const rt = runtime();
    rt.execute = async () => { runs += 1; return 'events: 3'; };
    expect(await runToolCall(rt, call('{"day":"today"}'))).toBe('events: 3');
    expect(await runToolCall(rt, call('{"day":"today"}'))).toBe('events: 3');
    const third = await runToolCall(rt, call('{"day":"today"}'));
    expect(third).toMatch(/already called mcp0__list_events with exactly these arguments 2 times[\s\S]*events: 3/);
    expect(runs).toBe(2);
    expect(advanceToolRound(rt, ['mcp0__list_events'])?.final).toBeFalsy();
    const fourth = await runToolCall(rt, call('{"day":"today"}'));
    expect(fourth).toMatch(/4 times[\s\S]*no further tool calls/);
    expect(runs).toBe(2);
    const next = advanceToolRound(rt, ['mcp0__list_events']);
    expect(next?.final).toBe(true);
    expect(rt.stats).toMatchObject({ cappedBy: 'loop', repeated: { mcp0__list_events: 2 } });
  });

  it('a call with other arguments is not a repeat', async () => {
    const rt = runtime();
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri']) await runToolCall(rt, call(`{"day":"${day}"}`));
    expect(rt.stats.repeated).toBeUndefined();
    expect(rt.stats.loopCall).toBeFalsy();
  });

  it('a loop is still a loop after a hand-over (SQEM-649): the counts travel, the results do not', async () => {
    let runs = 0;
    const rt = runtime();
    rt.execute = async () => { runs += 1; return 'fresh'; };
    rt.callCounts = { [callKey('mcp0__list_events', '{"day":"today"}')]: 2 };
    const third = await runToolCall(rt, call('{"day":"today"}'));
    expect(runs).toBe(1); // no earlier result in this invocation: run once more, with the note
    expect(third).toMatch(/already called[\s\S]*fresh/);
    expect(rt.stats.repeated).toEqual({ mcp0__list_events: 1 });
  });

  it('chat-message hands the counts over and no longer has per-kind limits', () => {
    const chat = readFileSync('supabase/functions/chat-message/index.ts', 'utf8');
    expect(chat).toMatch(/callCounts: \{ \.\.\.\(tools\.callCounts \?\? \{\}\) \}/);
    expect(chat).toMatch(/maxRounds: MAX_TOOL_ROUNDS/);
    expect(chat).not.toMatch(/TOOL_ROUNDS_BYOK|TOOL_ROUNDS_FUNDED|maxLibraryRounds/);
  });
});

describe('SQEM-648 — every MCP tool is classified', () => {
  it('each tool the chat offers is either a lookup or deliberately work', () => {
    const defs = readFileSync('supabase/functions/_shared/libraryToolDefs.ts', 'utf8');
    const names = [...new Set([...defs.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1]))].sort();
    const WORK = ['attach_template', 'create_persona', 'create_template', 'create_upload_url', 'delete_file',
      'delete_persona', 'delete_template', 'detach_template', 'finalize_upload', 'import_skill_from_url',
      'update_persona', 'update_template', 'upload_file', 'set_access', 'set_editors'];
    // A new tool fails this test until someone decides which side it is on.
    expect(names.filter(n => !isLibraryOnlyRound([n]) && !WORK.includes(n))).toEqual([]);
    expect(names.filter(n => isLibraryOnlyRound([n])).sort()).toEqual(
      ['download_skill', 'get_persona', 'get_template', 'list_files', 'list_members', 'list_personas', 'list_templates', 'read_context_file', 'search_templates']);
  });
});
