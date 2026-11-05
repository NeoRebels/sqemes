import { m, type Locale } from './locale.ts';
/**
 * SQEM-466/584 — the line under an answer that had to do without a connector.
 *
 * ⚠️ SQEM-652 removed the provider-side half of this module (`refusedConnectorLabels`,
 * `openaiRefusedConnectorLabels`): Anthropic and OpenAI used to fail a whole request over one MCP server
 * they could not reach, and we read the refused label out of their error to retry without it. Since
 * every provider calls connectors through sqemes, a connector that cannot list its tools is left out
 * before the request (`loadConnectorTools` → `failed`) and named with this notice.
 */

/**
 * What the person reads when a connector was left out.
 *
 * ⛔ **Silence was the alternative and it is the wrong one** — the same argument as `toolCapNotice`.
 * Somebody who asks about their Shopify orders and gets an answer without Shopify will believe the
 * answer. The notice is not politeness; it is the difference between a degraded answer and a wrong
 * one.
 */
export function connectorRefusedNotice(names: string[], locale: Locale = 'en'): string {
  if (!names.length) return '';
  const list = names.join(', ');
  // SQEM-604 — in the user's language; one text each for one and several (the pronoun changes too).
  const text = names.length === 1
    ? m.server_connector_refused_one({ list }, { locale })
    : m.server_connector_refused_many({ list }, { locale });
  return `\n\n---\n_${text}_`;
}
