/**
 * SQEM-640 — one paging contract for the connector servers sqemes runs itself (`mcp-shopify`,
 * `mcp-outlook`, `mcp-msgraph`).
 *
 * Every list tool takes an optional `cursor` and answers `{ items, nextCursor? }`; `nextCursor` is there
 * only when there is more. Until 2026-11-03 these tools returned the first 25–50 entries and nothing
 * else — a monthly Shopify analysis (a customer) saw at most the 25 newest orders of a filter and could not
 * ask for the rest. Servers run by others (Notion, Linear, Chatarmin …) page through their own tools.
 *
 * ⚠️ The model decides whether it needs another page; nothing here pages on its own. Every page is a
 * tool round, and a page is bounded so it fits the 20,000 characters our own MCP client keeps of a
 * result (`MCP_RESULT_MAX_CHARS`).
 *
 * Pure: no Deno, no fetch — so the unit tests can import it.
 */

export const CURSOR_PROPERTY = {
  type: 'string',
  description: 'Optional. Pass the nextCursor of the previous result to get the next page. Omit for the first page.',
} as const;

export const clip = (n: unknown, def: number, max: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
};

/** The answer of a list tool: `{ items }`, plus `nextCursor` only when there is more. */
export function pageJson<T>(items: T[], nextCursor: string | null | undefined): string {
  return JSON.stringify(nextCursor ? { items, nextCursor } : { items });
}

// ── Shopify (Admin GraphQL connections) ─────────────────────────────────────

/** `products|orders|customers(first, after) { edges { node } pageInfo { hasNextPage endCursor } }` */
export function shopifyPage(conn: any): { items: any[]; nextCursor: string | null } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const items = (conn?.edges ?? []).map((e: any) => e.node); // eslint-disable-line @typescript-eslint/no-explicit-any
  const info = conn?.pageInfo;
  return { items, nextCursor: info?.hasNextPage && typeof info.endCursor === 'string' ? info.endCursor : null };
}

/** A Shopify cursor is opaque base64-ish text; anything else is not one of ours. */
export function shopifyCursor(cursor: unknown): string | null {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9+/=_-]+$/.test(cursor)) {
    throw new Error('Invalid cursor: pass the nextCursor of the previous result unchanged.');
  }
  return cursor;
}

// ── Microsoft Graph (`@odata.nextLink`) ─────────────────────────────────────

export const GRAPH_ORIGIN = 'https://graph.microsoft.com';
const GRAPH_VERSION = '/v1.0';

/**
 * The path (relative to `/v1.0`, query included) a Graph cursor points to — or null for the first page.
 *
 * ⛔ **The cursor is a URL the server will call with the customer's token, and the model hands it
 * over.** So it is accepted only on Graph's own origin and version — the token never goes anywhere
 * else — and only for the same kind of list the tool returns (the last path segment, e.g. `children`,
 * `messages`, `calendarView`): the calendar tool cannot be turned into a reader of the mailbox. The
 * real boundary behind that is the token: each connector's token carries only its own scopes.
 * ⚠️ Not the full path: Graph may write a nextLink in canonical form (`/users/{id}/…`, `/drives/{id}/…`)
 * rather than the `/me/…` it was asked with. Anything that does not match is an error, never a silent
 * first page.
 */
export function graphCursorPath(cursor: unknown, basePath: string): string | null {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  const bad = () => new Error('Invalid cursor: pass the nextCursor of the previous result unchanged.');
  if (typeof cursor !== 'string' || cursor.length > 4096) throw bad();
  let u: URL;
  try { u = new URL(cursor); } catch { throw bad(); }
  if (u.origin !== GRAPH_ORIGIN || u.username || u.password) throw bad();
  if (!u.pathname.startsWith(GRAPH_VERSION + '/')) throw bad();
  const path = u.pathname.slice(GRAPH_VERSION.length);
  if (lastSegment(path) !== lastSegment(basePath)) throw bad();
  return path + u.search;
}

/** `/me/drive/root/search(q='x')?$top=5` → `search`; `/me/calendarView` → `calendarview`. */
function lastSegment(path: string): string {
  const seg = decodeURIComponent(path.split('?')[0]).split('/').filter(Boolean).pop() ?? '';
  return seg.replace(/\(.*$/, '').toLowerCase();
}

/** `value` + `@odata.nextLink` of a Graph list response, as one page. */
export function graphPage<T>(data: any, map: (x: any) => T): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const next = typeof data?.['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
  return pageJson((data?.value ?? []).map(map), next);
}

/** Microsoft Search (`/search/query`) pages by offset; its cursor is that offset as text. */
export function searchOffset(cursor: unknown): number {
  if (cursor === undefined || cursor === null || cursor === '') return 0;
  const n = typeof cursor === 'string' && /^\d{1,6}$/.test(cursor) ? Number(cursor) : NaN;
  if (!Number.isFinite(n)) throw new Error('Invalid cursor: pass the nextCursor of the previous result unchanged.');
  return n;
}
