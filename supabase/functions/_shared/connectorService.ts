/**
 * SQEM-641 — which SERVICE a connector connects to, so a persona can name a service instead of one
 * person's connection.
 *
 * ⛔ SQEM-639 stored connector row ids on the persona. A personal connector is one row PER PERSON with
 * its own credentials, so an id saved by one author switched nothing on for anybody else — which is why
 * 639 could only offer shared connectors. A persona now stores `{ key, name }`; in Chat each person's own
 * connection to that service is used, a shared one otherwise, and over MCP only the name is mentioned.
 *
 * The key:
 * - a one-click app: `app:<provider>:<name>` — the app's provider and its registry name (the dedup key
 *   the connector code already uses). Microsoft's services share one shim URL and differ only in
 *   `?service=`, so for apps the URL would be the wrong key.
 * - any other MCP server: `url:<origin><path>` — lower-cased, trailing slashes dropped.
 *   ⛔ **Never the query string.** A server may carry a token there, and the key is written into a
 *   persona every editor can read.
 *
 * ⚠️ Known edge, accepted: two connections to the same app (two Shopify shops) are one service; a
 * persona then switches on the person's first one. Pure — imported by the app and the edge functions.
 */

export interface ConnectorLike {
  provider?: string | null;
  name: string;
  mcp_url: string;
}

export interface PersonaConnector {
  key: string;
  name: string;
}

/**
 * Providers whose connectors are custom MCP servers rather than one-click apps: none/`manual` (added by
 * address, SQEM-149) and `mcp` (added by address with OAuth discovery — `connector-oauth-start`, where
 * the person chose the name, so the name says nothing about the service).
 */
const CUSTOM_PROVIDERS = new Set(['', 'manual', 'custom', 'mcp']);

export function connectorServiceKey(c: ConnectorLike): string {
  const provider = (c.provider ?? '').trim().toLowerCase();
  if (!CUSTOM_PROVIDERS.has(provider)) return `app:${provider}:${c.name.trim().toLowerCase()}`;
  try {
    const u = new URL(c.mcp_url);
    const path = u.pathname.replace(/\/+$/, '');
    return `url:${u.origin.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return `url:${c.mcp_url.split('?')[0].trim().toLowerCase().replace(/\/+$/, '')}`;
  }
}

const MAX_CONNECTORS = 20;

/** What may be stored or read as a persona's connectors: an array of `{ key, name }`, bounded, deduplicated. */
export function parsePersonaConnectors(raw: unknown): PersonaConnector[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PersonaConnector[] = [];
  for (const item of raw) {
    const key = typeof item?.key === 'string' ? item.key.trim().slice(0, 300) : '';
    const name = typeof item?.name === 'string' ? item.name.replace(/[\r\n]+/g, ' ').trim().slice(0, 100) : '';
    if (!/^(app|url):/.test(key) || !name || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name });
    if (out.length >= MAX_CONNECTORS) break;
  }
  return out;
}

/**
 * For each service of a persona: the connection THIS person uses — their own first, a shared one
 * otherwise — or none. `userId` is the person in the chat; `connectors` is what they can see.
 */
export function resolvePersonaConnectors<T extends ConnectorLike & { id: string; user_id: string | null }>(
  services: PersonaConnector[],
  connectors: T[],
  userId: string,
): { ids: string[]; missing: PersonaConnector[] } {
  const ids: string[] = [];
  const missing: PersonaConnector[] = [];
  for (const s of services) {
    const matching = connectors.filter(c => connectorServiceKey(c) === s.key);
    const pick = matching.find(c => c.user_id === userId) ?? matching.find(c => c.user_id === null);
    if (pick) ids.push(pick.id);
    else missing.push(s);
  }
  return { ids, missing };
}
