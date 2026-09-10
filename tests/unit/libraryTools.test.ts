import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIBRARY_TOOLS, createLibraryToolRuntime, toolCapNotice, toolsWereRefused,
  toOpenAiTools, toClaudeTools, toGeminiTools,
} from '../../supabase/functions/_shared/libraryTools';
import { LibraryNotFound, LibraryBadRequest } from '../../supabase/functions/_shared/libraryQueries';

/**
 * SQEM-373 — the library as tools, and the four properties the ticket's Definition of Done names.
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const code = (src: string) => src
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const CHAT_FN = code(readFileSync(root('supabase/functions/chat-message/index.ts'), 'utf8'));
const MCP_FN  = code(readFileSync(root('supabase/functions/mcp-server/index.ts'), 'utf8'));

/** A reader that records what it was asked, so the adapter can be tested without a database. */
function fakeReader(overrides: Record<string, any> = {}) {
  const seen: any[] = [];
  const reader: any = {
    searchTemplates: async (a: any) => { seen.push(['searchTemplates', a]); return [{ id: '1', name: 'brief' }]; },
    getTemplate:     async (a: any) => { seen.push(['getTemplate', a]);     return { id: '1', name: 'brief', contextFiles: [] }; },
    readContextFile: async (a: any) => { seen.push(['readContextFile', a]); return { name: 'n.md', mimeType: 'text/markdown', text: 'body', base64: null, uri: 'sqemes://files/1' }; },
    listPersonas:    async () => { seen.push(['listPersonas']); return [{ id: 'p', name: 'editor' }]; },
    getPersona:      async (a: any) => { seen.push(['getPersona', a]); return { text: '---\npersona: Editor\n---', routeCount: 2 }; },
    ...overrides,
  };
  return { reader, seen };
}

describe('the tool schemas — what all three providers accept', () => {
  it('⛔ no schema keyword Gemini rejects', () => {
    // Gemini validates a declaration against its own OpenAPI subset and refuses the whole REQUEST
    // when it meets a keyword it does not know — with an error about the request, not the schema.
    const serialised = JSON.stringify(LIBRARY_TOOLS);
    for (const forbidden of ['additionalProperties', '$schema', 'oneOf', 'anyOf', 'allOf', '$ref']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('⚠️ Gemini gets ONE tool object, and a parameterless tool carries no `parameters` key', () => {
    // `properties: {}` is rejected rather than read as "no arguments".
    const [tool] = toGeminiTools(LIBRARY_TOOLS);
    expect(tool.functionDeclarations).toHaveLength(LIBRARY_TOOLS.length);
    const listPersonas = tool.functionDeclarations.find((d: any) => d.name === 'list_personas')!;
    expect(listPersonas).not.toHaveProperty('parameters');
    const getTemplate = tool.functionDeclarations.find((d: any) => d.name === 'get_template')!;
    expect(getTemplate).toHaveProperty('parameters');
  });

  it('OpenAI wraps each tool in a function envelope; Claude renames the schema key', () => {
    expect(toOpenAiTools(LIBRARY_TOOLS)[0]).toMatchObject({ type: 'function', function: { name: 'search_templates' } });
    expect(toClaudeTools(LIBRARY_TOOLS)[0]).toHaveProperty('input_schema');
  });

  it('⭐ list_templates is deliberately NOT offered in Chat', () => {
    // It is the one call whose response grows with the workspace. `search_templates` answers the
    // same question for the price of the matches; MCP keeps the listing, where the client decides
    // when to spend it.
    expect(LIBRARY_TOOLS.map(t => t.name)).toEqual([
      'search_templates', 'get_template', 'read_context_file', 'list_personas', 'get_persona',
    ]);
    expect(MCP_FN).toContain("toolName === 'list_templates'");
  });
});

describe('the executor', () => {
  it('⭐ get_template defaults to include_files: "list" — the lazy-loading requirement', async () => {
    // ⛔ The default flips between surfaces on purpose: `libraryQueries` keeps `inline` so every MCP
    // caller written against SQEM-230 gets byte-identical output. In Chat the whole point is that
    // context arrives as an outline and the full text only on a second call.
    const { reader, seen } = fakeReader();
    const rt = createLibraryToolRuntime(async () => reader);
    await rt.execute('get_template', { name: 'brief' });
    expect(seen[0][1].includeFiles).toBe('list');

    await rt.execute('get_template', { name: 'brief', include_files: 'inline' });
    expect(seen[1][1].includeFiles).toBe('inline');
  });

  it('the reader is built once, and only when a tool is actually called', async () => {
    // Building one costs four queries. Most messages call no tool at all; paying that on every
    // message to serve the minority would slow down the common path for nothing.
    let built = 0;
    const { reader } = fakeReader();
    const rt = createLibraryToolRuntime(async () => { built += 1; return reader; });
    expect(built).toBe(0);
    await rt.execute('list_personas', {});
    await rt.execute('list_personas', {});
    expect(built).toBe(1);
  });

  it('⛔ a failed lookup NEVER throws out of execute', async () => {
    // The model can recover from "not found" — try another name, or answer without it. An exception
    // here surfaces to the user as a failed message instead.
    const { reader } = fakeReader({
      getTemplate: async () => { throw new LibraryNotFound('Template not found'); },
      searchTemplates: async () => { throw new LibraryBadRequest('Missing search query'); },
      listPersonas: async () => { throw new Error('connection reset'); },
    });
    const rt = createLibraryToolRuntime(async () => reader);

    expect(JSON.parse(await rt.execute('get_template', { name: 'x' }))).toEqual({ error: 'Template not found' });
    expect(JSON.parse(await rt.execute('search_templates', {}))).toEqual({ error: 'Missing search query' });
    // An unexpected fault is reported as one rather than disguised as "not found" — a database
    // outage that reads as a missing template is the kind of error somebody loses an afternoon to.
    expect(JSON.parse(await rt.execute('list_personas', {})).error).toContain('connection reset');
    expect(JSON.parse(await rt.execute('no_such_tool', {}))).toEqual({ error: 'Unknown tool: no_such_tool' });
  });

  it('a binary context file is refused in words, not in base64', async () => {
    // Chat cannot hand raw bytes back through a tool result, and saying so beats returning base64
    // the model cannot use but still pays for.
    const { reader } = fakeReader({
      readContextFile: async () => ({ name: 'a.pdf', mimeType: 'application/pdf', text: null, base64: 'AAAA', uri: 'u' }),
    });
    const rt = createLibraryToolRuntime(async () => reader);
    const out = JSON.parse(await rt.execute('read_context_file', { uri: 'sqemes://files/1' }));
    expect(out.error).toMatch(/binary/i);
    expect(JSON.stringify(out)).not.toContain('AAAA');
  });

  it('⚠️ a huge result is truncated, and says so', async () => {
    // It goes back into the next request in full: one 2 MB context file would be paid for on every
    // remaining round and would blow the window rather than fail cleanly.
    const { reader } = fakeReader({
      readContextFile: async () => ({ name: 'big.md', mimeType: 'text/markdown', text: 'x'.repeat(200_000), base64: null, uri: 'u' }),
    });
    const rt = createLibraryToolRuntime(async () => reader);
    const out = await rt.execute('read_context_file', { uri: 'u' });
    expect(out.length).toBeLessThan(100_000);
    expect(out).toContain('truncated');
  });

  it('a persona comes back as markdown, not wrapped in JSON', async () => {
    const { reader } = fakeReader();
    const rt = createLibraryToolRuntime(async () => reader);
    expect(await rt.execute('get_persona', { name: 'editor' })).toContain('persona: Editor');
  });

  it('⭐ every call is counted, per tool — before anything is limited', async () => {
    // The lesson of SQEM-351/352: a limit chosen before the usage is measured limits the wrong
    // thing. `byTool` answers what the cap cannot — whether a long message is one template read
    // properly or the same search four times.
    const { reader } = fakeReader();
    const rt = createLibraryToolRuntime(async () => reader);
    await rt.execute('search_templates', { query: 'a' });
    await rt.execute('search_templates', { query: 'b' });
    await rt.execute('get_persona', { name: 'editor' });
    expect(rt.stats.calls).toBe(3);
    expect(rt.stats.byTool).toEqual({ search_templates: 2, get_persona: 1 });
  });
});

describe('SQEM-373 — the wiring in chat-message', () => {
  it('⛔ the tools run as the CHAT USER, and no API-key path exists', () => {
    // The reason this is native tool calling and not our own MCP server as a connector: a connector
    // runs under the person who owns the API key, so a workspace-shared one would let anybody act as
    // its owner — the failure class SQEM-346 closed.
    expect(CHAT_FN).toMatch(/userId: user\.id/);
    expect(CHAT_FN).toMatch(/createLibraryReader\(\{ client: createAdminClient\(\), workspaceId, userId \}\)/);
    for (const keyPath of ['mcp_api_keys', 'hashKey', 'api_key_hash', 'authChallenge']) {
      expect(CHAT_FN).not.toContain(keyPath);
    }
  });

  it('⛔ Claude still withholds library tools when connectors are enabled', () => {
    // Its Messages API has one `tools` field and two writers: passing both would silently lose the
    // connectors rather than fail, and a connector that stops working without an error is the
    // hardest kind of bug to trace back.
    expect(CHAT_FN).toMatch(/connectors\?\.length \? null : \(tools \?\? null\)/);
  });

  it('⭐ SQEM-377/378 — the exclusion is PROVIDER-SPECIFIC, not blanket', () => {
    // It used to be `workspaceId && !connectors?.length` for everyone. On `/v1/responses` connectors
    // and function tools share one array, so OpenAI can have both.
    expect(CHAT_FN).not.toMatch(/workspaceId && !connectors\?\.length/);
    // ⛔ SQEM-378 put the remaining rule back at THIS level rather than leaving it only inside
    // `callClaude`: the library prompt is decided here too, and a prompt that promises tools the
    // provider never received is how a model starts inventing library contents (SQEM-326).
    expect(CHAT_FN).toMatch(/toolsBlockedByProvider = provider === 'claude' && !!connectors\?\.length/);
    expect(CHAT_FN).toMatch(/workspaceId && !toolsBlockedByProvider/);
  });

  it('⛔ the loop has a cap, and the cap is VISIBLE', () => {
    // A model cut off mid-investigation answers confidently from half the material, and nothing in
    // the reply would say so.
    expect(CHAT_FN).toMatch(/TOOL_ROUNDS_BYOK\s*=\s*\d+/);
    expect(CHAT_FN).toMatch(/TOOL_ROUNDS_FUNDED\s*=\s*\d+/);
    expect(CHAT_FN).toMatch(/if \(tools\?\.stats\.cappedAt\) result \+= toolCapNotice/);
    expect(toolCapNotice(6, 'rounds')).toContain('6');
    expect(toolCapNotice(6, 'time')).toMatch(/time/);
  });

  it('⛔ …and a DEADLINE, because time is the constraint that actually bites', () => {
    // The runtime kills the invocation at ~150 s and a killed function broadcasts NOTHING — the
    // client then sits on its own 180 s timeout with a spinner. A round cap cannot prevent that;
    // one slow provider call is already 120 s.
    expect(CHAT_FN).toMatch(/TOOL_BUDGET_MS\s*=\s*\d[\d_]*/);
    const fn = CHAT_FN.slice(CHAT_FN.indexOf('function advanceToolRound'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/Date\.now\(\) >= tools\.deadline/);
    expect(body).toMatch(/cappedBy = 'time'/);
  });

  it('the deadline is set from an injectable clock, so it is not a guess', () => {
    const { reader } = fakeReader();
    const rt = createLibraryToolRuntime(async () => reader, { budgetMs: 5_000, now: () => 1_000 });
    expect(rt.deadline).toBe(6_000);
  });

  it('⛔ the round counter drops the tools rather than asking the model to stop', () => {
    // A model asked to stop calling tools while it can still see them calls one anyway. Taking them
    // away is the only instruction it cannot ignore.
    const fn = CHAT_FN.slice(CHAT_FN.indexOf('function advanceToolRound'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/stats\.rounds \+= 1/);
    expect(body).toMatch(/return null/);
    expect(body).toMatch(/cappedAt/);
  });

  it('⛔ every provider accumulates its answer across rounds', () => {
    // The broadcaster streams every round into ONE message. Returning only the last round's text
    // would make the finished answer shorter than what the user already watched arrive, because the
    // client replaces on `result`.
    expect([...CHAT_FN.matchAll(/answer \+= text;/g)]).toHaveLength(4);
  });

  it('⛔ funded token usage is SUMMED across rounds, not replaced', () => {
    // With tools a message is several billed provider calls. Keeping only the last round's usage
    // would undercharge a workspace by exactly the lookups the model did on its behalf.
    expect(CHAT_FN).toMatch(/totalTokens \+= t/);
    expect(CHAT_FN).not.toMatch(/totalTokens = usage\.total_tokens/);
  });

  it('the call count is logged before any limit is tightened', () => {
    expect(CHAT_FN).toMatch(/\[chat-tools\]/);
  });
});

describe('SQEM-375 — a model that cannot do function tools', () => {
  it('⛔ a 400 that names tools is a refusal', () => {
    // OpenAI, verbatim from production: the model has a default `reasoning_effort` we never set and
    // cannot see, and attaching tools makes it reject the whole request.
    expect(toolsWereRefused(400,
      'Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions.',
    )).toBe(true);
  });

  it('⚠️ …and NOTHING else is', () => {
    // Deliberately narrow. Retrying without tools is a degradation; doing it for an unrelated 400
    // would hide a real error behind a slightly worse answer.
    expect(toolsWereRefused(400, 'Invalid API key')).toBe(false);
    expect(toolsWereRefused(429, 'rate limit on tool calls')).toBe(false);
    expect(toolsWereRefused(500, 'tool service unavailable')).toBe(false);
  });

  it('⛔ every provider path retries WITHOUT tools, and cannot loop doing it', () => {
    // Four paths, one rule. `activeTools = null` is what bounds it: the retry can never take this
    // branch again, because the branch requires tools to have been sent.
    const retries = [...CHAT_FN.matchAll(/if \(activeTools && toolsWereRefused\(response\.status, errText\)\)/g)];
    expect(retries).toHaveLength(4);
    expect([...CHAT_FN.matchAll(/activeTools\.stats\.toolsRefused = true;/g)]).toHaveLength(4);
  });

  it('⛔ a refusal is LOGGED, even though it makes zero tool calls', () => {
    // The trap in its own guard: a refusal means `calls === 0`, so a `calls > 0` log condition would
    // silence exactly the case worth knowing about.
    expect(CHAT_FN).toMatch(/tools\.stats\.calls > 0 \|\| tools\.stats\.toolsRefused/);
  });
});

describe('SQEM-373 — mcp-server shares the handlers rather than keeping its own', () => {
  it('⛔ no second copy of the access rule or the read handlers', () => {
    // An access rule fixed on one surface and left standing on the other is a security bug that
    // reads like a feature gap.
    expect(MCP_FN).toMatch(/import \{[\s\S]*?createLibraryReader[\s\S]*?\} from '\.\.\/_shared\/libraryQueries\.ts'/);
    expect(MCP_FN).not.toMatch(/rpc\('mcp_accessible_template_ids'/);
    expect(MCP_FN).not.toMatch(/function contextFileStats|function resolveContextFiles|function composePersona|function buildPreview/);
  });

  it('⚠️ get_template keeps its `inline` default on MCP', () => {
    // Every client written against SQEM-230 expects inline; changing it would alter the payload of
    // callers that never asked for anything.
    expect(MCP_FN).toMatch(/includeFiles: args\.include_files \?\? 'inline'/);
  });
});
