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
import { LIBRARY_TOOL_DEFS, TOOL_CAPABILITY, SELF_HOST_HIDDEN_TOOLS } from './libraryToolDefs.ts';
import { describeChange, type LibraryChange } from './libraryChanges.ts';
import { m, type Locale } from './locale.ts';
import type { PersonaConnector } from './connectorService.ts';
import { isTruncatedArgs, parseToolArgs } from './toolStream.ts';

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
 * ⭐ **Chat's own five** — the reads Chat has answered since SQEM-373, with Chat's conventions (a
 * binary file is refused rather than linked, every result bounded). Everything else MCP offers is
 * added by role from the shared handlers (`chatActionDefinitions`, SQEM-561) — including
 * `list_templates`, which SQEM-373 had kept out because its answer grows with the workspace.
 *
 * Every description is written for a model that has never seen Sqemes, and each one names the tool
 * it should call next — a model that knows a template exists but not how to open it invents the
 * contents instead of fetching them.
 */
export const LIBRARY_TOOLS: ToolDefinition[] = [
  {
    name: 'search_templates',
    description:
      "Search this workspace's library of reusable templates (prompts and skills the team has curated) by keyword. The query is matched as text in titles and descriptions, so search ONE word; with no match, try another word or list_templates (SQEM-681). " +
      'Call this before writing, drafting, reviewing or rewriting anything substantial from scratch — if the team already has a template for it, following theirs beats improvising. ' +
      'Returns id, name, kind and description. Load one with get_template. ' +
      'A match that carries context files also reports contextFileCount and contextBytes; use them to decide how to load it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match against template titles and descriptions.' },
        kind: { type: 'string', enum: ['prompt', 'skill'], description: 'Optional filter by template kind.' },
        tag: { type: 'string', description: 'Optional: only templates carrying this workspace tag.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_template',
    description:
      'Load a template in full — its content, system instruction, variables and context files — by name slug or id. ' +
      'A skill\'s context files come back as an outline by default: name, size and a preview (markdown gets its heading outline) instead of the full text; a prompt comes back with its files in full. ' +
      'Read the one you actually need with read_context_file — by its uri, or by the playbook plus the file\'s path inside the skill (references/x.md). ' +
      'Files under assets/ or scripts/ are resources, listed without a preview. Pass include_files: "inline" only when you know you want every attached file in full.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The template\'s name slug, as returned by search_templates.' },
        id: { type: 'string', description: 'The template\'s id. Use either name or id.' },
        include_files: {
          type: 'string',
          enum: ['list', 'inline'],
          description: 'Default: "list" for a skill, "inline" for a prompt. "list" returns context files as an outline with previews; "inline" puts their full text into the content.',
        },
      },
    },
  },
  {
    name: 'read_context_file',
    description:
      'Read one context file in full — by the uri from a get_template outline (sqemes://files/<id>), or by template plus path: ' +
      'the path inside the skill exactly as its SKILL.md writes it (references/animation.md). ' +
      'Use this after get_template has shown you which files exist and what is in them — read only the ones the task actually needs.',
    parameters: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The file uri from a template\'s contextFiles entry.' },
        template: { type: 'string', description: 'The template\'s name slug or id, when addressing the file by path.' },
        path: { type: 'string', description: 'The file\'s path inside the skill, e.g. references/animation.md. Use together with template.' },
      },
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

/**
 * SQEM-561 — every other MCP tool, offered in Chat by role: reading to everyone, changing only to an
 * editor or admin — every tool, bounded by access and "Who can edit" as on MCP. The descriptions are
 * MCP's own (`LIBRARY_TOOL_DEFS`), written once.
 *
 * ⛔ Two are left out because they cannot work here: `create_upload_url` hands out a URL to PUT bytes
 * to, and `finalize_upload` registers what was PUT. A model in Chat holds no bytes and has no way to
 * PUT them — offered, they would only invite a call that cannot succeed. Text files go through
 * `upload_file`; anything binary is uploaded on the Files page.
 *
 * ⚠️ `list_templates` was deliberately absent from Chat since SQEM-373 (its answer grows with the
 * workspace, and `search_templates` answers the same question for the price of the matches). It is
 * offered now because Chat carries every tool; the result is still bounded like any other.
 */
export const CHAT_EXCLUDED_TOOLS = ['create_upload_url', 'finalize_upload'];

const CHAT_OWN_TOOLS = new Set(LIBRARY_TOOLS.map(t => t.name));

/**
 * ⚠️ Gemini rejects an object schema without `properties` ("should be non-empty for OBJECT type"), and
 * MCP's `variables` items are exactly that. Chat gets the item shape spelled out; MCP keeps its own.
 */
const VARIABLE_ITEM = {
  type: 'object',
  properties: {
    name:  { type: 'string', description: 'Variable name as used in {{name}}' },
    label: { type: 'string', description: 'Optional label shown to the user' },
    type:  { type: 'string', enum: ['text', 'textarea'], description: 'Optional; defaults to text' },
  },
  required: ['name'],
};

function forChat(schema: Record<string, unknown>): ToolDefinition['parameters'] {
  const props = { ...((schema.properties as Record<string, unknown>) ?? {}) };
  if (props.variables) props.variables = { ...(props.variables as object), items: VARIABLE_ITEM };
  const out: ToolDefinition['parameters'] = { type: 'object', properties: props };
  if (Array.isArray(schema.required)) out.required = schema.required as string[];
  return out;
}

/** The tools Chat adds to its own five, for a person holding `role`. */
export function chatActionDefinitions(role: string | null, { selfHosted = false }: { selfHosted?: boolean } = {}): ToolDefinition[] {
  const managesContent = role === 'admin' || role === 'editor';
  return LIBRARY_TOOL_DEFS
    .filter(d => !CHAT_OWN_TOOLS.has(d.name) && !CHAT_EXCLUDED_TOOLS.includes(d.name))
    .filter(d => !(selfHosted && SELF_HOST_HIDDEN_TOOLS.includes(d.name))) // SQEM-663
    .filter(d => TOOL_CAPABILITY[d.name] === 'read' || managesContent)
    .map(d => ({ name: d.name, description: d.description, parameters: forChat(d.inputSchema as Record<string, unknown>) }));
}

/** What a shared handler answered — `LibraryToolOutcome` from `_shared/libraryActions.ts`, structurally. */
export type ActionOutcome =
  | { ok: true; result: { content: unknown[] } }
  | { ok: false; code: number; message: string };

export interface ChatActions {
  definitions: ToolDefinition[];
  /** Runs one shared handler as the chat user, with the reader the runtime holds. */
  run(name: string, args: Record<string, unknown>, lib: LibraryReader): Promise<ActionOutcome>;
}

/** The text a model reads back from an outcome. Images (MCP-only content) are left out. */
export function outcomeText(outcome: ActionOutcome): string {
  // `'message' in` rather than `!outcome.ok`: this tsconfig is not strict, and a boolean
  // discriminant does not narrow without strictNullChecks.
  if ('message' in outcome) return JSON.stringify({ error: outcome.message });
  return outcome.result.content
    .filter((c): c is { type: 'text'; text: string } => !!c && (c as { type?: string }).type === 'text' && typeof (c as { text?: unknown }).text === 'string')
    .map(c => c.text)
    .join('\n');
}

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
  /** Which cap fired. Logged so they are told apart before any is tuned. SQEM-650: `loop` — a repeated call. */
  cappedBy: 'rounds' | 'time' | 'loop' | null;
  /**
   * SQEM-375 — the provider refused the request BECAUSE tools were attached, and it was retried
   * without them.
   *
   * ⚠️ Counted rather than swallowed. The user gets an answer either way, so without this number the
   * degradation is invisible — and "how many people silently lose the library tools" is exactly what
   * has to be known before deciding whether `/v1/responses` is worth building.
   */
  toolsRefused: boolean;
  /**
   * SQEM-638 — connectors whose tools were taken out of the request because the provider refused the
   * tool list; the library stayed. Named under the reply.
   */
  refusedConnectors: string[];
  /** SQEM-637 — the provider's own reason for its last stop (`stopReasonOf`); logged, never acted on. */
  stopReason: string | null;
  /**
   * SQEM-616 — calls not carried out because their arguments were cut off at the output limit
   * (`isTruncatedArgs`), by tool. Logged, and the reply says so.
   */
  truncated: Record<string, number>;
  /**
   * SQEM-648 — rounds in which ONLY library lookups ran (`LIBRARY_LOOKUP_TOOLS`). Since SQEM-650 counted
   * for the log only: the separate guard (8) and the work cap (6/4) gave way to loop detection and one
   * emergency cap (`MAX_TOOL_ROUNDS`).
   */
  libraryRounds: number;
  /**
   * SQEM-648 — connector calls the PROVIDER ran itself (OpenAI `mcp_call`, Claude `mcp_tool_use`). They
   * never pass through `execute`, so `byTool` cannot show them; without this a connector-free answer
   * and a connector call that returned nothing looked the same in the log.
   */
  nativeConnectorCalls: number;
  /**
   * SQEM-652 — tokens the provider reported for this answer (Claude, OpenAI), summed over its rounds,
   * for the log: the measurement "connectors through the provider vs through sqemes" rests on them.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** SQEM-654 — the part of `inputTokens` the provider served from its prompt cache. */
  cachedInputTokens?: number;
  /** SQEM-654 — the part of `inputTokens` written into the cache (Claude only, billed at 1.25×). */
  cacheWriteTokens?: number;
  /**
   * SQEM-649 — how often this answer was handed to a new invocation (`_shared/chatContinuation.ts`).
   * Optional so a runtime built before 649 (and every test fixture) stays valid.
   */
  continuations?: number;
  /**
   * SQEM-650 — calls the model repeated with the same arguments (third time and later), by tool. The
   * third gets the earlier result back with a note; the fourth ends the tool use (`cappedBy: 'loop'`).
   */
  repeated?: Record<string, number>;
  /** SQEM-650 — set when a call came a fourth time; `advanceToolRound` then caps with `loop`. */
  loopCall?: string | null;
}

/**
 * SQEM-648 — the read-only library tools. A round made only of these is preparation, not work.
 * ⚠️ Writes (`update_template`, …) are deliberately NOT here: a change counts as work.
 */
export const LIBRARY_LOOKUP_TOOLS: ReadonlySet<string> = new Set([
  'search_templates', 'get_template', 'read_context_file', 'list_personas', 'get_persona',
  // ⚠️ The chat actions (SQEM-561) add read-only tools of their own. The first version of this set
  // missed these three; seven days of `[chat-tools]` showed `list_templates` and `list_files` in
  // capped persona chains. A new read-only MCP tool belongs here too — the test lists them all.
  'list_templates', 'list_files', 'download_skill',
  'list_members', // SQEM-663
]);

/**
 * SQEM-650 — the emergency cap, for the whole answer across every invocation (SQEM-649).
 *
 * ⛔ Not a budget. Since an answer can go on for 10 minutes a round count no longer protects anything
 * a person cares about — what does harm is a model REPEATING itself, and that is caught by name and
 * arguments (`runToolCall`). This only catches a loop that varies its arguments. It replaced the
 * guards of SQEM-648 (8 library rounds, 6 work rounds, 4 on credits): the Chief of Staff with „Alles“
 * hit those on honest work, and with time no longer the end of a worker they had no reason left.
 */
export const MAX_TOOL_ROUNDS = 40;

/** SQEM-650 — the same call this many times gets the earlier result and a note; one more ends tool use. */
export const REPEAT_WARN_AT = 3;

/**
 * SQEM-648 — connector calls the provider ran itself: OpenAI Responses output items `mcp_call`,
 * Claude content blocks `mcp_tool_use` (in a stream they arrive as `content_block_start.content_block`).
 * Counting only; these are never executed here (see the `tool_use` filter in `_shared/toolStream.ts`).
 */
export function countNativeConnectorCalls(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.filter((i: any) => i?.type === 'mcp_call' || i?.type === 'mcp_tool_use').length;
}

/** SQEM-648 — true when every call of a round was a library lookup (an empty round is not one). */
export function isLibraryOnlyRound(names: string[]): boolean {
  return names.length > 0 && names.every(n => LIBRARY_LOOKUP_TOOLS.has(n));
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
   * SQEM-650 — how often each call (tool + arguments, `callKey`) was made in this answer, and the last
   * result of each in THIS invocation. The counts travel with a hand-over (SQEM-649); the results do
   * not — they are in the provider's own history already.
   */
  callCounts?: Record<string, number>;
  lastResults?: Map<string, string>;
  /** SQEM-648 — `stats.nativeConnectorCalls` at the end of the last round (bookkeeping for `advanceToolRound`). */
  nativeCallsSeen?: number;
  /**
   * ⛔ **The binding constraint is TIME, not rounds.** The client gives up at 180 s
   * (`CLIENT_JOB_TIMEOUT_MS.default`), and a single provider call may take 120 s. Six rounds of a
   * slow model would run past the client, which then shows a timeout while the worker is still busy
   * — and on a free-tier self-host the worker itself is killed at 150 s and broadcasts nothing. A
   * round cap alone cannot prevent that; only a deadline can. (SQEM-381 corrected this from a
   * free-plan wall clock (150 s) as if it were ours; see `_shared/chatTimeouts.ts`.)
   *
   * Epoch milliseconds. Past it, no NEW tool round is started — the round already in flight still
   * finishes, which is why the budget leaves headroom rather than filling the window.
   */
  deadline: number;
  /**
   * SQEM-637 — set by `advanceToolRound` when a cap fired: the next round is the LAST. The tools stay
   * declared and calling them is forbidden in the provider's own words (Gemini `mode: NONE`, the others
   * `tool_choice: none`); a call that comes anyway is not executed.
   *
   * ⛔ Until 2026-11-03 the last round sent no tools at all, with tool calls still in the history.
   * Gemini answered that with nothing (a customer, 6 rounds, 14 calls, "No content generated").
   */
  final?: boolean;
  /**
   * SQEM-649 — asked when `deadline` passes: may the answer go on in a new invocation? Absent ⇒ no
   * (the time cap as before). `chat-message` sets it from the chain's 10 minutes.
   */
  mayContinue?: () => boolean;
  /**
   * SQEM-649 — set by `advanceToolRound` instead of `final` when `mayContinue` said yes: the loop hands
   * its state over (`ChatContinuation`) rather than starting another round in this worker.
   */
  handoff?: boolean;
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
    // SQEM-658 — what the cut means: an excerpt, not the file; a count or total over it is a guess.
    + `\n\n[truncated by sqemes — ${text.length - MAX_RESULT_CHARS} more characters were not included. The source is complete; only this result is an excerpt. Do not count, sum or search across all of it from this part — say the answer covers only what is shown.]`;
}

/**
 * The message the user sees when the loop is cut off.
 *
 * ⛔ Silence was the alternative and it is the wrong one: a model that stops mid-investigation
 * produces a confident answer built on half the material, and nothing in the reply says so.
 */
/**
 * SQEM-616 — run one call the model made, unless its arguments were cut off.
 *
 * ⛔ A truncated call is NOT executed: `{}` would reach the tool and come back as "name is required",
 * which the model reads as its own mistake and answers by sending the same oversized call again. The
 * model is told what actually happened instead, so it can say so or split the work.
 */
export async function runToolCall(tools: ToolRuntime, call: { name: string; args: string }): Promise<string> {
  if (isTruncatedArgs(call.args)) {
    tools.stats.truncated[call.name] = (tools.stats.truncated[call.name] ?? 0) + 1;
    return `Your call to ${call.name} was cut off at the output limit of one turn, so it was NOT carried out and nothing changed. `
      + 'Its arguments were too long to write in one go. Do not send the same content again in one call — tell the user plainly '
      + 'that the content was too large to write in one step, and offer a smaller change if one would do.';
  }
  // SQEM-650 — the same call with the same arguments, again and again, is the loop worth stopping.
  const key = callKey(call.name, call.args);
  const counts = (tools.callCounts ??= {});
  const n = (counts[key] ?? 0) + 1;
  counts[key] = n;
  const earlier = tools.lastResults?.get(key);
  if (n >= REPEAT_WARN_AT) {
    const repeated = (tools.stats.repeated ??= {});
    repeated[call.name] = (repeated[call.name] ?? 0) + 1;
    if (n > REPEAT_WARN_AT) tools.stats.loopCall = call.name; // `advanceToolRound` makes the next round the last
    const note = n > REPEAT_WARN_AT
      ? `You have now called ${call.name} with exactly these arguments ${n} times. It was NOT run again, and no further tool calls are possible for this answer. Answer from what you have.`
      : `You already called ${call.name} with exactly these arguments ${n - 1} times. It was not run again; the earlier result follows. Do not repeat it — use the result, try something different, or answer.`;
    if (earlier !== undefined) return `${note}\n\n${earlier}`;
    if (n > REPEAT_WARN_AT) return note;
    // The earlier result is from an earlier invocation (SQEM-649): run it once more, with the note.
  }
  const result = await tools.execute(call.name, parseToolArgs(call.args));
  (tools.lastResults ??= new Map()).set(key, result);
  return n >= REPEAT_WARN_AT ? `You already called ${call.name} with exactly these arguments ${n - 1} times. Do not repeat it again.\n\n${result}` : result;
}

/**
 * SQEM-650 — what makes two calls "the same": the tool and its arguments, with object keys sorted so
 * `{a,b}` and `{b,a}` match. Arguments that do not parse are compared as written.
 */
export function callKey(name: string, args: string): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sort((v as any)[k])])) : v;
  let canonical = args;
  try { canonical = JSON.stringify(sort(JSON.parse(args || '{}'))); } catch { /* as written */ }
  return `${name}\u0000${canonical}`;
}

/** SQEM-616 — the line under a reply in which a call was cut off; empty when none was. */
export function truncatedNotice(stats: ToolStats, locale: Locale = 'en'): string {
  const names = Object.keys(stats.truncated);
  if (!names.length) return '';
  return `\n\n---\n_${m.chat_tool_truncated({ tools: names.join(', ') }, { locale })}_`;
}

/** SQEM-638 — a connector's tools carry `mcp<i>__` (see `connectorFunctionName`); the library's never do. */
const CONNECTOR_TOOL = /^mcp\d+__/;

/**
 * SQEM-638 — the next attempt after a provider refused the tool list (`toolsWereRefused`).
 *
 * ⛔ **Connectors go first, the library last.** Until 2026-11-03 a refusal dropped EVERY tool: one
 * connector with a schema Gemini does not accept (an empty enum value in declaration 244 of ~250) cost
 * the person their playbooks, personas and files as well, five times in a row, without a word. The
 * connectors' tools are the ones that come from outside and the likely cause; the library's own are
 * written by us. So: retry without the connector tools; refused again, retry without any (the old
 * behaviour). Bounded — the second refusal finds no connector tools left and returns null.
 */
export function afterToolsRefused(tools: ToolRuntime): ToolRuntime | null {
  const kept = tools.definitions.filter(d => !CONNECTOR_TOOL.test(d.name));
  if (kept.length > 0 && kept.length < tools.definitions.length) {
    const names = new Set<string>();
    for (const d of tools.definitions) {
      if (!CONNECTOR_TOOL.test(d.name)) continue;
      const label = /^\[([^\]]+)\]/.exec(d.description)?.[1]; // `[Display name] …`, see loadConnectorTools
      if (label) names.add(label);
    }
    tools.stats.refusedConnectors = [...names];
    return { ...tools, definitions: kept };
  }
  tools.stats.toolsRefused = true;
  return null;
}

/**
 * SQEM-638 — the line under a reply that had to do without tools. Until then the loss was only logged,
 * and an answer without the library reads exactly like an answer from a library that has nothing.
 */
export function toolsRefusedNotice(stats: ToolStats, locale: Locale = 'en'): string {
  if (stats.toolsRefused) return `\n\n---\n_${m.chat_tools_refused_all({}, { locale })}_`;
  if (stats.refusedConnectors.length) {
    return `\n\n---\n_${m.chat_tools_refused_connectors({ list: stats.refusedConnectors.join(', ') }, { locale })}_`;
  }
  return '';
}

/**
 * SQEM-637 — what an empty answer says. After a cap the model had material and wrote nothing, which is
 * not the same as "no content": the person can narrow the request or switch the model.
 */
export function noAnswerText(stats: ToolStats | null | undefined, locale: Locale = 'en'): string {
  return stats?.cappedAt ? m.chat_tool_cap_empty({}, { locale }) : m.chat_no_content({}, { locale });
}

export function toolCapNotice(rounds: number, reason: 'rounds' | 'time' | 'loop' = 'rounds', locale: Locale = 'en'): string {
  // SQEM-595 — the tools are no longer only library lookups. SQEM-599 — the first server text in two languages.
  const text = reason === 'time'
    ? m.chat_tool_cap_time({}, { locale })
    : reason === 'loop'
      ? m.chat_tool_cap_loop({}, { locale }) // SQEM-650
      : m.chat_tool_cap_rounds({ rounds }, { locale });
  return `\n\n---\n_${text}_`;
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
  { maxRounds = MAX_TOOL_ROUNDS, budgetMs = 90_000, now = () => Date.now(), onTemplateLoaded, actions, onChange, onPersonaLoaded }:
    {
      maxRounds?: number; budgetMs?: number; now?: () => number;
      /** SQEM-517 — told after a playbook was loaded, so the caller can count it. Never awaited. */
      onTemplateLoaded?: (templateId: string) => void;
      /** SQEM-561 — the shared MCP handlers, injected so this module stays importable by tests. */
      actions?: ChatActions;
      /** SQEM-561 — told after every successful change, for the card under the answer. */
      onChange?: (change: LibraryChange) => void;
      /**
       * SQEM-651 — a persona was loaded: Chat fetches its connector services. The text it returns is
       * added to the persona, so the model knows what it now has and what is missing.
       */
      onPersonaLoaded?: (connectors: PersonaConnector[]) => Promise<string>;
    } = {},
): ToolRuntime {
  const stats: ToolStats = { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false, refusedConnectors: [], stopReason: null, truncated: {}, libraryRounds: 0, nativeConnectorCalls: 0 };

  let readerPromise: Promise<LibraryReader> | null = null;
  const reader = () => (readerPromise ??= getReader());
  const actionNames = new Set((actions?.definitions ?? []).map(d => d.name));

  return {
    definitions: [...LIBRARY_TOOLS, ...(actions?.definitions ?? [])],
    maxRounds,
    callCounts: {},
    lastResults: new Map(),
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
              tag: typeof args.tag === 'string' ? args.tag : null, // SQEM-663
            })));

          case 'get_template':
            // ⭐ The default follows the KIND, as on MCP since SQEM-499: a skill arrives as an outline, a
            // prompt with its files (they are part of the task, and no prompt body names its files).
          {
            const t = await lib.getTemplate({
              id: typeof args.id === 'string' ? args.id : undefined,
              name: typeof args.name === 'string' ? args.name : undefined,
              includeFiles: typeof args.include_files === 'string' ? args.include_files : 'auto', // SQEM-499: skill → list, prompt → inline (as on MCP)
            });
            try { onTemplateLoaded?.(t.id); } catch { /* a counter never costs the answer */ }
            return bound(JSON.stringify(t));
          }

          case 'read_context_file': {
            // SQEM-499 — by uri, or by template + path inside the skill (one implementation for MCP and Chat).
            const tpl = typeof args.template === 'string' ? args.template : '';
            const file = typeof args.uri === 'string' && args.uri
              ? await lib.readContextFile(args.uri)
              : await lib.readContextFileByPath({
                  ...(/^[0-9a-f-]{36}$/i.test(tpl) ? { id: tpl } : { name: tpl }),
                  path: String(args.path ?? ''),
                });
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
            const { text, connectors } = await lib.getPersona({
              id: typeof args.id === 'string' ? args.id : undefined,
              name: typeof args.name === 'string' ? args.name : undefined,
            });
            // SQEM-651 — a failure to fetch never costs the persona.
            let fetched = '';
            if (onPersonaLoaded && connectors?.length) {
              try { fetched = await onPersonaLoaded(connectors); } catch (e) { console.warn('[chat-connectors] persona fetch failed:', (e as Error)?.message); }
            }
            return bound(text + fetched);
          }

          default: {
            // ⛔ Only a tool that was OFFERED runs — a member is never offered a write, so a write name
            // a model invents is "unknown" here, before the handler's own role gate is even reached.
            if (!actions || !actionNames.has(name)) return JSON.stringify({ error: `Unknown tool: ${name}` });
            const outcome = await actions.run(name, args, lib);
            const text = outcomeText(outcome);
            if (outcome.ok && TOOL_CAPABILITY[name] !== 'read') {
              /**
               * ⛔ The access sets were resolved before this write. A playbook created a moment ago is
               * not in them, so the next call in the same answer — attach it, fix a typo — would say
               * "not found". Every write therefore drops the reader; the next call builds a fresh one.
               */
              readerPromise = null;
              const change = describeChange(name, args, text);
              if (change) { try { onChange?.(change); } catch { /* the card never costs the answer */ } }
            }
            return bound(text);
          }
        }
      } catch (err) {
        // ⛔ Never thrown onward. A failed lookup is something the model can recover from — try
        // another name, or answer without it — and an exception here would surface to the user as a
        // failed message instead.
        // SQEM-561 — a write that throws is not a lookup; say which, so the model does not report a
        // change as made (or as merely not found) when it does not know.
        const failed = TOOL_CAPABILITY[name] && TOOL_CAPABILITY[name] !== 'read' ? 'The change failed' : 'Lookup failed';
        const message = (err instanceof LibraryNotFound || err instanceof LibraryBadRequest)
          ? err.message
          : `${failed}: ${(err as Error)?.message ?? 'unknown error'}`;
        return JSON.stringify({ error: message });
      }
    },
  };
}

/**
 * SQEM-373 — count the round, and drop the tools once the cap is reached.
 *
 * ⛔ Returning `null` is what forces the next round to be an ANSWER: a model asked to stop calling
 * tools while it can still see them calls one anyway. Taking them away is the only instruction it
 * cannot ignore. `cappedAt` then puts a line in the reply, so the user is not left with a confident
 * answer built on half the material and nothing saying so.
 */
export function advanceToolRound(tools: ToolRuntime, callNames: string[] = [], now: () => number = () => Date.now()): ToolRuntime | null {
  tools.stats.rounds += 1;
  // SQEM-648 — a round of pure library lookups is preparation; counted for the log since SQEM-650,
  // which replaced its guard and the work cap with loop detection and `MAX_TOOL_ROUNDS`.
  // A round in which the provider also ran a connector itself is work, whatever else it called.
  const nativeInRound = tools.stats.nativeConnectorCalls > (tools.nativeCallsSeen ?? 0);
  tools.nativeCallsSeen = tools.stats.nativeConnectorCalls;
  const libraryOnly = !nativeInRound && isLibraryOnlyRound(callNames);
  if (libraryOnly) tools.stats.libraryRounds += 1;
  // SQEM-637 — a call returned in the last round is not executed, so there is no round after it.
  if (tools.final) return null;
  // SQEM-650 — a call repeated a fourth time (`runToolCall`): the next round answers —
  // before the clock, so a loop is not handed to a new invocation first (SQEM-649).
  if (tools.stats.loopCall) {
    tools.stats.cappedAt = tools.stats.rounds;
    tools.stats.cappedBy = 'loop';
    return { ...tools, final: true };
  }
  // ⛔ Time first, because it is the constraint that actually bites: the client gives up at 180 s
  // and shows a timeout while the worker is still working — and on a free-tier self-host the worker
  // itself is killed at 150 s, broadcasting NOTHING. The round cap only guards a model that loops on
  // cheap calls.
  if (now() >= tools.deadline) {
    // SQEM-649 — the worker's time is up, the chain's is not: the next round runs in a new invocation.
    if (tools.mayContinue?.()) {
      tools.stats.continuations = (tools.stats.continuations ?? 0) + 1;
      return { ...tools, handoff: true };
    }
    tools.stats.cappedAt = tools.stats.rounds;
    tools.stats.cappedBy = 'time';
    return { ...tools, final: true }; // SQEM-637 — tools stay declared, calling them is forbidden
  }
  if (tools.stats.rounds < tools.maxRounds) return tools;
  tools.stats.cappedAt = tools.stats.rounds;
  tools.stats.cappedBy = 'rounds';
  return { ...tools, final: true };
}

/**
 * SQEM-649 — rebuild a runtime in the next invocation from the state the last one handed over.
 *
 * The counters come back as they were (so the round caps and the log count the WHOLE answer, not one
 * invocation), and a refusal stays a refusal: tools the provider turned away earlier are not offered
 * again (SQEM-638). `forceFinal` is the fallback when the hand-over itself failed — the next round is
 * the answer, with the time notice.
 */
export function restoreToolRuntime(
  runtime: ToolRuntime,
  saved: { stats: Partial<ToolStats>; nativeCallsSeen?: number; callCounts?: Record<string, number> },
  { forceFinal = false }: { forceFinal?: boolean } = {},
): ToolRuntime | null {
  Object.assign(runtime.stats, saved.stats);
  runtime.nativeCallsSeen = saved.nativeCallsSeen ?? runtime.stats.nativeConnectorCalls;
  if (saved.callCounts) runtime.callCounts = { ...saved.callCounts }; // SQEM-650 — repeats count across invocations
  if (runtime.stats.toolsRefused) return null;
  let restored: ToolRuntime = runtime.stats.refusedConnectors.length
    ? { ...runtime, definitions: runtime.definitions.filter(d => !CONNECTOR_TOOL.test(d.name)) }
    : runtime;
  if (forceFinal) {
    runtime.stats.cappedAt = runtime.stats.rounds;
    runtime.stats.cappedBy = 'time';
    restored = { ...restored, final: true };
  }
  return restored;
}
