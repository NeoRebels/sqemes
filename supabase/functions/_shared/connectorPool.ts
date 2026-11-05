/**
 * SQEM-651 — the model sees every connected service by NAME and fetches a service's tools only when it
 * needs them.
 *
 * ⛔ **Why.** Until SQEM-635 every connector was in every request, with all its tools (2026-11-03: over
 * 244 declarations for three connectors), and models called a connector the task did not need (one customer:
 * Chatarmin during a PDF layout, then over a million tokens). SQEM-635 answered with switches, off by
 * default — which meant a person had to know beforehand which systems a question would touch. The
 * question (2026-11-04) was why Claude and ChatGPT carry fifty connectors without trouble: they
 * defer the tool definitions until the model asks for them. This is that, for sqemes Chat.
 *
 * How it works:
 * - `chat-message` lists the connectors the person may use (their own and the shared ones) — names and
 *   ids only, no token is read for a connector the model never fetches.
 * - `use_connector(service)` (Chat only, never on MCP) fetches one. Loading a persona (`get_persona`)
 *   fetches its services: the person's own connection first, a shared one otherwise (SQEM-641).
 * - A fetched connector joins from the NEXT round of the same answer: Claude and OpenAI take it as an
 *   MCP server (`ConnectorPool.added`, read by their loops); every other provider gets its tools as
 *   functions, pushed into the runtime's own definitions array (the loops read that array every round).
 * - Fetched connectors stay for the session: the result carries the ids, the browser stores them in
 *   `chat_sessions.connector_ids` and sends them with the next message.
 *
 * ⚠️ It only ever ADDS. Nothing the model does removes a connector, and there is no lock: the owner
 * decided against one (2026-11-04).
 *
 * ⚠️ What this does NOT solve: on Claude and OpenAI the provider runs the connector itself, so a huge
 * result still goes into the context unshortened. That is SQEM-652. The old switches never prevented it
 * either — a task that needs the service had the switch on.
 *
 * Pure apart from the injected resolver and loader, so tests/unit drive every path.
 */
import type { ToolDefinition, ToolRuntime } from './libraryTools.ts';
import type { LoadedConnectorTools, McpSession } from './mcpClient.ts';
import { resolvePersonaConnectors, type PersonaConnector } from './connectorService.ts';
import { m, type Locale } from './locale.ts';

/** A connector the person may use, as listed at the start of an answer. No credentials. */
export interface AvailableConnector {
  id: string;
  name: string;
  mcp_url: string;
  provider: string | null;
  user_id: string | null;
}

/** What a fetched connector must carry — `chat-message`'s `ResolvedConnector` satisfies it. */
export interface PoolConnector {
  id: string;
  displayName: string;
}

export interface ConnectorPoolDeps<C extends PoolConnector> {
  /** Decrypt (and refresh) the connectors with these ids. Only ids from `available` are ever passed. */
  resolve(ids: string[]): Promise<C[]>;
  /**
   * Providers without their own MCP support: list the tools of newly fetched connectors. `offset`
   * keeps the `mcp<i>__` function names unique across loads. Absent ⇒ Claude/OpenAI (they run MCP).
   */
  load?: (connectors: C[], offset: number) => Promise<LoadedConnectorTools>;
}

export const USE_CONNECTOR_TOOL = 'use_connector';
/** At most this many names in the tool description; a workspace with more is not the case to tune for. */
const MAX_LISTED = 50;

/**
 * The label the model uses for a connector: the name the person gave it, made unique. Two connectors
 * with one name (two Shopify shops, an own and a shared Gmail) get `(2)`, `(3)` — the model cannot tell
 * them apart either way, and a stable label is better than a guess.
 */
export function connectorLabels(available: AvailableConnector[]): Map<string, AvailableConnector> {
  const out = new Map<string, AvailableConnector>();
  const seen = new Map<string, number>();
  for (const c of available.slice(0, MAX_LISTED)) {
    const base = (c.name || 'Connector').replace(/[\r\n"]+/g, ' ').trim().slice(0, 80) || 'Connector';
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    out.set(n === 1 ? base : `${base} (${n})`, c);
  }
  return out;
}

export function useConnectorDefinition(labels: string[]): ToolDefinition {
  return {
    name: USE_CONNECTOR_TOOL,
    description:
      'Fetch the tools of one of the services the user connected, so you can use it from your next step on. '
      + 'Use it when the task needs data or an action from that service; do not fetch a service the task does not need. '
      + 'A fetched service stays available for the rest of this chat. '
      + `Services: ${labels.join(', ')}.`,
    parameters: {
      type: 'object',
      properties: { service: { type: 'string', enum: labels, description: 'The service, exactly as listed.' } },
      required: ['service'],
    },
  };
}

export class ConnectorPool<C extends PoolConnector> {
  readonly labels: Map<string, AvailableConnector>;
  /** Every connector in this answer: those the request carried, then those fetched. */
  readonly active: C[];
  /** Fetched in THIS invocation — what the Claude/OpenAI loops add to their next request. */
  readonly added: C[] = [];
  /** Display names fetched during the whole answer (across hand-overs), for the line under it. */
  readonly fetchedNames: string[];
  /** Tools of fetched connectors on providers without MCP; the wrapper pushes these into its array. */
  private onTools: ((defs: ToolDefinition[]) => void) | null = null;
  readonly routes = new Map<string, { session: McpSession; tool: string }>();
  /** Connectors whose tools could not be listed — named under the answer like SQEM-584's. */
  readonly failed: string[] = [];
  private loadOffset: number;

  constructor(
    readonly available: AvailableConnector[],
    initial: C[],
    private deps: ConnectorPoolDeps<C>,
    { fetchedNames = [], loadOffset = initial.length }: { fetchedNames?: string[]; loadOffset?: number } = {},
  ) {
    this.labels = connectorLabels(available);
    this.active = [...initial];
    this.fetchedNames = [...fetchedNames];
    this.loadOffset = loadOffset;
  }

  /** The ids to carry on with: on a hand-over and in the result for the session. */
  activeIds(): string[] {
    return this.active.map(c => c.id);
  }

  isActive(id: string): boolean {
    return this.active.some(c => c.id === id);
  }

  setToolSink(sink: (defs: ToolDefinition[]) => void): void {
    this.onTools = sink;
  }

  /** Fetch these connectors (ids from `available` only). Returns the display names that joined. */
  async fetch(ids: string[]): Promise<{ added: string[]; failed: string[] }> {
    const allowed = new Set(this.available.map(c => c.id));
    const wanted = [...new Set(ids)].filter(id => allowed.has(id) && !this.isActive(id));
    if (!wanted.length) return { added: [], failed: [] };
    const resolved = await this.deps.resolve(wanted);
    const failedHere: string[] = [];
    let joined = resolved;
    if (this.deps.load && resolved.length) {
      const loaded = await this.deps.load(resolved, this.loadOffset);
      this.loadOffset += resolved.length;
      for (const [name, route] of loaded.routes) this.routes.set(name, route);
      if (loaded.definitions.length) this.onTools?.(loaded.definitions);
      failedHere.push(...loaded.failed);
      joined = resolved.filter(c => !loaded.failed.includes(c.displayName));
    }
    this.active.push(...joined);
    this.added.push(...joined);
    for (const c of joined) if (!this.fetchedNames.includes(c.displayName)) this.fetchedNames.push(c.displayName);
    this.failed.push(...failedHere);
    return { added: joined.map(c => c.displayName), failed: failedHere };
  }

  /** `use_connector(service)`: the label as the model gave it, matched exactly, then without case. */
  byLabel(label: string): AvailableConnector | null {
    const exact = this.labels.get(label);
    if (exact) return exact;
    const lower = label.trim().toLowerCase();
    for (const [l, c] of this.labels) if (l.toLowerCase() === lower) return c;
    return null;
  }

  /**
   * A persona was loaded: fetch its services, the person's own connection first (SQEM-641). The text
   * goes back to the model with the persona, so it knows what it now has and what is missing.
   */
  async fetchForPersona(services: PersonaConnector[], userId: string): Promise<string> {
    if (!services.length) return '';
    const { ids, missing } = resolvePersonaConnectors(services, this.available, userId);
    const already = ids.filter(id => this.isActive(id)).map(id => this.available.find(c => c.id === id)!.name);
    const { added, failed } = await this.fetch(ids);
    const lines: string[] = [];
    const ready = [...already, ...added];
    if (ready.length) lines.push(`Connected services available for this chat: ${ready.join(', ')}. Use them when a step needs them.`);
    if (failed.length) lines.push(`Could not reach: ${failed.join(', ')}.`);
    if (missing.length) lines.push(`Not connected by this user: ${missing.map(s => s.name).join(', ')}. If the task needs one, tell the user they can connect it under Settings → Connectors.`);
    return lines.length ? `\n\n## Connectors\n\n${lines.join('\n')}` : '';
  }
}

/**
 * Adds `use_connector` to a runtime, and — on providers without MCP — the tools of fetched connectors.
 *
 * ⛔ The definitions array is created HERE and mutated in place when a connector joins. The loops read
 * `activeTools.definitions` every round, and `advanceToolRound`/`restoreToolRuntime` copy the runtime
 * with `{ ...tools }`, which keeps this same array — so a push here reaches the next request. Wrap last,
 * after `restoreToolRuntime`, so no earlier copy holds an older array.
 *
 * ⚠️ After the provider refused the connector tools (`afterToolsRefused`, SQEM-638) nothing more is
 * fetched on those providers: the copy it makes no longer shares this array, and the provider would
 * refuse again anyway.
 */
export function withConnectorPool<C extends PoolConnector>(
  runtime: ToolRuntime,
  pool: ConnectorPool<C>,
  signal?: AbortSignal,
): ToolRuntime {
  if (!pool.labels.size) return runtime;
  const definitions: ToolDefinition[] = [...runtime.definitions, useConnectorDefinition([...pool.labels.keys()])];
  pool.setToolSink(defs => { definitions.push(...defs); });
  return {
    ...runtime,
    definitions,
    stats: runtime.stats,
    async execute(name, args) {
      const route = pool.routes.get(name);
      if (route) {
        runtime.stats.calls += 1;
        runtime.stats.byTool[name] = (runtime.stats.byTool[name] ?? 0) + 1;
        try {
          return await route.session.callTool(route.tool, args, signal);
        } catch (e) {
          if (signal?.aborted) throw e; // Stop (SQEM-583) ends the turn, it is not a tool error
          return JSON.stringify({ error: `The connector did not answer: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      if (name !== USE_CONNECTOR_TOOL) return runtime.execute(name, args);
      runtime.stats.calls += 1;
      runtime.stats.byTool[name] = (runtime.stats.byTool[name] ?? 0) + 1;
      if (runtime.stats.refusedConnectors.length) return 'Connector tools cannot be used with this model in this answer.';
      const c = pool.byLabel(String(args.service ?? ''));
      if (!c) return JSON.stringify({ error: `Unknown service. Use one of: ${[...pool.labels.keys()].join(', ')}` });
      if (pool.isActive(c.id)) return `${c.name} is already available. Use its tools.`;
      const { added, failed } = await pool.fetch([c.id]);
      if (added.length) return `${c.name} is connected for this chat. Its tools are available from your next step on.`;
      return `${failed.length ? 'Could not reach' : 'Could not connect'} ${c.name}. Answer without it and tell the user.`;
    },
  };
}

/** The line under an answer that fetched a connector — the person sees what the model reached into. */
export function connectorsFetchedNotice(names: string[], locale: Locale = 'en'): string {
  if (!names.length) return '';
  return `\n\n---\n_${m.chat_connectors_fetched({ list: names.join(', ') }, { locale })}_`;
}
