/**
 * SQEM-373 — the workspace library as tools the model can call, in three wire formats.
 *
 * ⛔ **Not via our own MCP server as a connector**, although that would have worked. The ticket
 * records the three reasons; the sharp one is identity: a connector runs under the person who owns
 * the API key, so a workspace-shared connector holding A's key would let B act as A — exactly the
 * failure class SQEM-346 closed. Native tool calling runs in our infrastructure under the chat
 * user's own id, and reaches five more providers besides.
 *
 * ⚠️ The handlers behind these tools are NOT defined here. They live in `_shared/libraryQueries.ts`
 * and are the same ones `mcp-server` calls. This module is the adapter: schemas, the per-provider
 * shape, and the dispatch.
 */

import {
  type LibraryReader,
  LibraryBadRequest,
  LibraryNotFound,
} from './libraryQueries.ts';

// ── Provider-neutral definitions ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /**
   * JSON Schema, kept to the subset all three providers accept.
   *
   * ⚠️ **No `additionalProperties`, no `$schema`, no `oneOf`.** Gemini validates the declaration
   * against its own OpenAPI subset and rejects the whole request when it meets a keyword it does not
   * know — with an error about the request, not about the schema, so the cause is not obvious.
   */
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

/**
 * ⭐ **Five tools, not six.** `list_templates` is deliberately absent from Chat even though
 * `mcp-server` offers it: it is the one call whose response grows with the workspace (78 templates
 * on production today), and `search_templates` answers the same question for the price of the
 * matches. In MCP the listing is cheap because the client decides when to spend it; here it would
 * land in a conversation the user is paying tokens for.
 *
 * Every description is written for a model that has never seen Sqemes, and each one names the tool
 * it should call next — a model that knows a template exists but not how to open it invents the
 * contents instead of fetching them.
 */
export const LIBRARY_TOOLS: ToolDefinition[] = [
  {
    name: 'search_templates',
    description:
      "Search this workspace's library of reusable templates (prompts, assistants, and skills the team has curated) by keyword; matches title and description. " +
      'Call this before writing, drafting, reviewing or rewriting anything substantial from scratch — if the team already has a template for it, following theirs beats improvising. ' +
      'Returns id, name, kind and description. Load one with get_template. ' +
      'A match that carries context files also reports contextFileCount and contextBytes; use them to decide how to load it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match against template titles and descriptions.' },
        kind: { type: 'string', enum: ['prompt', 'assistant', 'skill'], description: 'Optional filter by template kind.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_template',
    description:
      'Load a template in full — its content, system instruction, variables and context files — by name slug or id. ' +
      'Context files come back as an outline by default: name, size and a preview (markdown gets its heading outline) instead of the full text. ' +
      'Read the one you actually need with read_context_file on its uri. Pass include_files: "inline" only when you know you want every attached file in full.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The template\'s name slug, as returned by search_templates.' },
        id: { type: 'string', description: 'The template\'s id. Use either name or id.' },
        include_files: {
          type: 'string',
          enum: ['list', 'inline'],
          description: '"list" (default) returns context files as an outline with previews; "inline" puts their full text into the content.',
        },
      },
    },
  },
  {
    name: 'read_context_file',
    description:
      'Read one context file in full, by the uri from a get_template outline (sqemes://files/<id>). ' +
      'Use this after get_template has shown you which files exist and what is in them — read only the ones the task actually needs.',
    parameters: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The file uri from a template\'s contextFiles entry.' },
      },
      required: ['uri'],
    },
  },
  {
    name: 'list_personas',
    description:
      'List the working roles this workspace defines. A persona bundles several templates behind conditions saying which to load when. ' +
      'Call this when a task clearly belongs to a role rather than a single template, or when the user names a role without giving its exact title.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_persona',
    description:
      'Load a persona by name slug or id: its role description and its routing table. ' +
      'Adopt the persona, then load a route with get_template only once its condition applies — loading every route at once is exactly what a persona exists to avoid.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The persona\'s name slug, as returned by list_personas.' },
        id: { type: 'string', description: 'The persona\'s id. Use either name or id.' },
      },
    },
  },
];

// ── Per-provider shape ──────────────────────────────────────────────────────

export const toOpenAiTools = (defs: ToolDefinition[]) => defs.map(d => ({
  type: 'function',
  function: { name: d.name, description: d.description, parameters: d.parameters },
}));

export const toClaudeTools = (defs: ToolDefinition[]) => defs.map(d => ({
  name: d.name,
  description: d.description,
  input_schema: d.parameters,
}));

/**
 * OpenAI's **Responses** API — flat, not nested under `function` the way chat completions wants it.
 *
 * ⛔ **`strict: false` is explicit and load-bearing.** Strict mode requires every property to be
 * required and `additionalProperties: false` on every object; our schemas have optional parameters by
 * design (`get_template` takes *either* `name` or `id`). A default that flips to strict would reject
 * the whole request, and the error names the schema, not the flag.
 */
export const toResponsesTools = (defs: ToolDefinition[]) => defs.map(d => ({
  type: 'function',
  name: d.name,
  description: d.description,
  parameters: d.parameters,
  strict: false,
}));

/**
 * Gemini takes ONE tool object holding every declaration, not one per tool.
 *
 * ⚠️ A parameterless tool must omit `parameters` entirely — an empty `properties: {}` is rejected by
 * the API rather than treated as "no arguments".
 */
export const toGeminiTools = (defs: ToolDefinition[]) => [{
  functionDeclarations: defs.map(d => {
    const decl: Record<string, unknown> = { name: d.name, description: d.description };
    if (Object.keys(d.parameters.properties).length > 0) decl.parameters = d.parameters;
    return decl;
  }),
}];

// ── The runtime handed to a provider call ───────────────────────────────────

export interface ToolStats {
  /** Provider round trips that came back asking for tools. */
  rounds: number;
  /** Individual tool calls executed. */
  calls: number;
  /** Per tool, so the cheap ones can be told apart from the expensive one. */
  byTool: Record<string, number>;
  /** Set when the cap stopped the loop — the user is told, rather than left with silence. */
  cappedAt: number | null;
  /** Which cap fired. Logged so the two are told apart before either is tuned. */
  cappedBy: 'rounds' | 'time' | null;
  /**
   * SQEM-375 — the provider refused the request BECAUSE tools were attached, and it was retried
   * without them.
   *
   * ⚠️ Counted rather than swallowed. The user gets an answer either way, so without this number the
   * degradation is invisible — and "how many people silently lose the library tools" is exactly what
   * has to be known before deciding whether `/v1/responses` is worth building.
   */
  toolsRefused: boolean;
}

export interface ToolRuntime {
  definitions: ToolDefinition[];
  /**
   * How many times the model may come back asking for tools before it must answer.
   *
   * ⚠️ **The number is a runaway guard, not a budget.** SQEM-351/352 taught that a limit chosen
   * before the usage is measured limits the wrong thing; `stats` is logged on every message so the
   * real distribution exists before anyone tightens this.
   */
  maxRounds: number;
  /**
   * ⛔ **The binding constraint is TIME, not rounds.** A Supabase edge function has ~150 s of wall
   * clock for the whole invocation, `EdgeRuntime.waitUntil` included, and a single provider call may
   * take up to 120 s (`fetchWithTimeout`). Six rounds of a slow model would therefore be killed by
   * the runtime — and a killed function broadcasts nothing at all, so the user watches a spinner
   * until the client's own 180 s timeout fires. A round cap alone cannot prevent that; only a
   * deadline can.
   *
   * Epoch milliseconds. Past it, no NEW tool round is started — the round already in flight still
   * finishes, which is why the budget leaves headroom rather than filling the window.
   */
  deadline: number;
  execute(name: string, args: Record<string, unknown>): Promise<string>;
  stats: ToolStats;
}

/**
 * ⚠️ **A tool result has to be bounded.** It goes back into the next request in full, so one 2 MB
 * context file would be paid for on every remaining round of the conversation — and would blow the
 * context window rather than fail cleanly. Truncation is announced in the text so the model knows it
 * is looking at part of a file and can say so, instead of answering confidently from a fragment.
 */
const MAX_RESULT_CHARS = 60_000;

function bound(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS)
    + `\n\n[truncated — ${text.length - MAX_RESULT_CHARS} more characters were not included]`;
}

/**
 * The message the user sees when the loop is cut off.
 *
 * ⛔ Silence was the alternative and it is the wrong one: a model that stops mid-investigation
 * produces a confident answer built on half the material, and nothing in the reply says so.
 */
export function toolCapNotice(rounds: number, reason: 'rounds' | 'time' = 'rounds'): string {
  const why = reason === 'time'
    ? 'ran out of time for further library lookups'
    : `stopped after ${rounds} rounds of library lookups`;
  return `\n\n---\n_Sqemes ${why} and answered with what had been loaded._`;
}

/**
 * ⭐ **The reader is a thunk, not a reader.** Building one costs four queries (three access sets and
 * the file union), and most chat messages never call a tool at all — paying that on every message to
 * serve the minority would have added latency to the common path for nothing. The thunk is resolved
 * on the first actual call and memoised here, so a message that calls three tools still builds one
 * reader.
 */
/**
 * SQEM-375 — did the provider refuse the request BECAUSE of the tools we attached?
 *
 * ⛔ **The capability is not discoverable in advance.** OpenAI answers
 * *"Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions"*
 * for a model whose default reasoning effort we never set and cannot see; a self-hoster can enter any
 * OpenAI-compatible endpoint at all, and many of those cannot do function calling either. There is no
 * list to check against — only the 400 that comes back.
 *
 * So the request is retried **once**, without tools. The user gets an answer instead of a provider
 * error; the library tools are lost for that message and the loss is COUNTED (`toolsRefused`), never
 * swallowed.
 *
 * ⚠️ Deliberately narrow: a 400 **and** the body mentioning tools **and** we actually sent some. A
 * 400 about anything else still fails the way it always did.
 */
export function toolsWereRefused(status: number, body: string): boolean {
  return status === 400 && /tool/i.test(body);
}

export function createLibraryToolRuntime(
  getReader: () => Promise<LibraryReader>,
  { maxRounds = 6, budgetMs = 90_000, now = () => Date.now() }:
    { maxRounds?: number; budgetMs?: number; now?: () => number } = {},
): ToolRuntime {
  const stats: ToolStats = { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false };

  let readerPromise: Promise<LibraryReader> | null = null;
  const reader = () => (readerPromise ??= getReader());

  return {
    definitions: LIBRARY_TOOLS,
    maxRounds,
    deadline: now() + budgetMs,
    stats,

    async execute(name, args) {
      stats.calls += 1;
      stats.byTool[name] = (stats.byTool[name] ?? 0) + 1;

      try {
        const lib = await reader();
        switch (name) {
          case 'search_templates':
            return bound(JSON.stringify(await lib.searchTemplates({
              query: String(args.query ?? ''),
              kind: typeof args.kind === 'string' ? args.kind : null,
            })));

          case 'get_template':
            // ⭐ **The default flips here, and only here.** `libraryQueries` keeps `inline` so every
            // existing MCP caller gets byte-identical output (SQEM-230). In Chat the whole point is
            // that context arrives as an outline first, so an omitted `include_files` means "list".
            return bound(JSON.stringify(await lib.getTemplate({
              id: typeof args.id === 'string' ? args.id : undefined,
              name: typeof args.name === 'string' ? args.name : undefined,
              includeFiles: typeof args.include_files === 'string' ? args.include_files : 'list',
            })));

          case 'read_context_file': {
            const file = await lib.readContextFile(String(args.uri ?? ''));
            if (file.text == null) {
              // A PDF or an image. Chat has no way to hand raw bytes back through a tool result, and
              // saying so beats returning base64 the model cannot use but still pays for.
              return JSON.stringify({
                name: file.name, mimeType: file.mimeType,
                error: 'This file is binary and cannot be read as text here.',
              });
            }
            return bound(JSON.stringify({ name: file.name, mimeType: file.mimeType, text: file.text }));
          }

          case 'list_personas':
            return bound(JSON.stringify(await lib.listPersonas()));

          case 'get_persona': {
            // Markdown, returned as-is: it is written to be read by the model, and wrapping it in
            // JSON would cost an escape pass for nothing.
            const { text } = await lib.getPersona({
              id: typeof args.id === 'string' ? args.id : undefined,
              name: typeof args.name === 'string' ? args.name : undefined,
            });
            return bound(text);
          }

          default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
        }
      } catch (err) {
        // ⛔ Never thrown onward. A failed lookup is something the model can recover from — try
        // another name, or answer without it — and an exception here would surface to the user as a
        // failed message instead.
        const message = (err instanceof LibraryNotFound || err instanceof LibraryBadRequest)
          ? err.message
          : `Lookup failed: ${(err as Error)?.message ?? 'unknown error'}`;
        return JSON.stringify({ error: message });
      }
    },
  };
}
