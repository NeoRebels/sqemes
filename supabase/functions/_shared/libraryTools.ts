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
import { LIBRARY_TOOL_DEFS, TOOL_CAPABILITY } from './libraryToolDefs.ts';
import { describeChange, type LibraryChange } from './libraryChanges.ts';
import { m, type Locale } from './locale.ts';

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
      "Search this workspace's library of reusable templates (prompts and skills the team has curated) by keyword; matches title and description. " +
      'Call this before writing, drafting, reviewing or rewriting anything substantial from scratch — if the team already has a template for it, following theirs beats improvising. ' +
      'Returns id, name, kind and description. Load one with get_template. ' +
      'A match that carries context files also reports contextFileCount and contextBytes; use them to decide how to load it.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match against template titles and descriptions.' },
        kind: { type: 'string', enum: ['prompt', 'skill'], description: 'Optional filter by template kind.' },
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
export function chatActionDefinitions(role: string | null): ToolDefinition[] {
  const managesContent = role === 'admin' || role === 'editor';
  return LIBRARY_TOOL_DEFS
    .filter(d => !CHAT_OWN_TOOLS.has(d.name) && !CHAT_EXCLUDED_TOOLS.includes(d.name))
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
export function toolCapNotice(rounds: number, reason: 'rounds' | 'time' = 'rounds', locale: Locale = 'en'): string {
  // SQEM-595 — the tools are no longer only library lookups. SQEM-599 — the first server text in two languages.
  const text = reason === 'time'
    ? m.chat_tool_cap_time({}, { locale })
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
  { maxRounds = 6, budgetMs = 90_000, now = () => Date.now(), onTemplateLoaded, actions, onChange }:
    {
      maxRounds?: number; budgetMs?: number; now?: () => number;
      /** SQEM-517 — told after a playbook was loaded, so the caller can count it. Never awaited. */
      onTemplateLoaded?: (templateId: string) => void;
      /** SQEM-561 — the shared MCP handlers, injected so this module stays importable by tests. */
      actions?: ChatActions;
      /** SQEM-561 — told after every successful change, for the card under the answer. */
      onChange?: (change: LibraryChange) => void;
    } = {},
): ToolRuntime {
  const stats: ToolStats = { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false };

  let readerPromise: Promise<LibraryReader> | null = null;
  const reader = () => (readerPromise ??= getReader());
  const actionNames = new Set((actions?.definitions ?? []).map(d => d.name));

  return {
    definitions: [...LIBRARY_TOOLS, ...(actions?.definitions ?? [])],
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
            const { text } = await lib.getPersona({
              id: typeof args.id === 'string' ? args.id : undefined,
              name: typeof args.name === 'string' ? args.name : undefined,
            });
            return bound(text);
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
