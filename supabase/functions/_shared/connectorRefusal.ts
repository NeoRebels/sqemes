/**
 * SQEM-466 — one connector the remote server turns away must not take the whole message with it.
 *
 * ⛔ **Anthropic fails the ENTIRE request when a single listed MCP server refuses the token.** Not
 * that server's call — the request. Measured on production, 2026-09-23:
 *
 *     Claude API error (400): {"type":"error","error":{"type":"invalid_request_error",
 *     "message":"mcp_servers[1] 'c_085c3fc0e0084c48a2ac828af22e': Authentication error while
 *     communicating with MCP server. Please check your authorization token."}, …}
 *
 * Since connectors are always active in chat (SQEM-436), every message carries every connector — so
 * one dead one killed plain text questions too. A customer sat with a broken chat for eleven days.
 *
 * ⚠️ **The label Anthropic echoes is OUR internal one** (`c_` + connector id), because that is what
 * we sent as the server name. It means nothing to a person, so the caller maps it back to the
 * connector's real name before anyone reads it.
 */

/** `mcp_servers[1] 'c_abc…'` — the index is Anthropic's, the label is ours. */
const REFUSED = /mcp_servers\[\d+\]\s*'([^']+)'/g;

/**
 * Labels of the connectors the provider refused, or `[]` when this is a different failure.
 *
 * ⚠️ Deliberately narrow: it matches the `mcp_servers[i] '<label>'` shape and nothing else. A looser
 * test would swallow unrelated 400s and silently drop connectors that were never the problem —
 * `toolsWereRefused` next to it is already `status === 400 && /tool/i.test(body)`, and that kind of
 * breadth is only safe because its remedy (retry without function tools) is harmless. Dropping a
 * connector is not harmless: it changes what the model can see.
 */
export function refusedConnectorLabels(status: number, body: string): string[] {
  if (status !== 400) return [];
  const out = new Set<string>();
  for (const m of body.matchAll(REFUSED)) out.add(m[1]);
  return [...out];
}

/**
 * What the person reads when a connector was left out.
 *
 * ⛔ **Silence was the alternative and it is the wrong one** — the same argument as `toolCapNotice`.
 * Somebody who asks about their Shopify orders and gets an answer without Shopify will believe the
 * answer. The notice is not politeness; it is the difference between a degraded answer and a wrong
 * one.
 */
export function connectorRefusedNotice(names: string[]): string {
  if (!names.length) return '';
  const list = names.join(', ');
  const which = names.length === 1 ? 'connector' : 'connectors';
  return `\n\n---\n_Answered without ${list}: the ${which} refused the connection. Reconnect ${names.length === 1 ? 'it' : 'them'} in Settings → Connectors._`;
}

/**
 * SQEM-572 — the OpenAI twin of `refusedConnectorLabels`.
 *
 * ⛔ OpenAI fails the WHOLE answer over one MCP server whose tool list it cannot fetch, just as Anthropic
 * does (SQEM-466) — and on `/v1/responses` it usually says so INSIDE the stream, after a 200:
 *
 *     Error retrieving tool list from MCP server: 'c_e6db0f67f1624eeeaceb5387ba20'.
 *     Http status code: 424 (Failed Dependency)
 *
 * (One connector whose token had expired made every ChatGPT message fail, while Claude, with SQEM-466,
 * answered without it.)
 *
 * ⚠️ Matched on the `MCP server: '<label>'` shape only, and only labels we actually sent count (the
 * caller filters): dropping a connector changes what the model can see, so this must not fire on an
 * unrelated error.
 */
const OPENAI_REFUSED = /MCP server:?\s*'([^']+)'/g;

export function openaiRefusedConnectorLabels(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? '').matchAll(OPENAI_REFUSED)) out.add(m[1]);
  return [...out];
}
