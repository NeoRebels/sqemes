import { describe, it, expect } from 'vitest';
import { refusedConnectorLabels, openaiRefusedConnectorLabels, connectorRefusedNotice } from '../../supabase/functions/_shared/connectorRefusal';

/**
 * SQEM-466 — parsed against the real thing, not an invented shape.
 *
 * The body below is the message a customer's chat produced on production (2026-09-23), verbatim
 * apart from the request id. One connector with no token at all — an OAuth flow begun and never
 * finished (SQEM-467) — and Anthropic failed the whole request because of it.
 */
const REAL = '{"type":"error","error":{"type":"invalid_request_error","message":"mcp_servers[1] '
  + "'c_085c3fc0e0084c48a2ac828af22e'"
  + ': Authentication error while communicating with MCP server. Please check your authorization token."},"request_id":"req_011CfLH77eKmWo2N3Q4EFU79"}';

describe('SQEM-466 — which connector did the provider turn away', () => {
  it('⛔ finds the label in the real production body', () => {
    expect(refusedConnectorLabels(400, REAL)).toEqual(['c_085c3fc0e0084c48a2ac828af22e']);
  });

  it('finds several, without duplicates', () => {
    const two = "mcp_servers[0] 'c_aaa': nope. mcp_servers[2] 'c_bbb': nope. mcp_servers[0] 'c_aaa': again.";
    expect(refusedConnectorLabels(400, two)).toEqual(['c_aaa', 'c_bbb']);
  });

  it('⚠️ stays out of failures that are not about connectors', () => {
    // Dropping a connector changes what the model can see. A loose match would do it on unrelated
    // 400s — so the shape must be present, and the status must be 400.
    expect(refusedConnectorLabels(400, 'overloaded_error: please retry')).toEqual([]);
    expect(refusedConnectorLabels(429, REAL)).toEqual([]);
    expect(refusedConnectorLabels(500, 'mcp_servers[1] is fine, server exploded')).toEqual([]);
  });

  it('⛔ the notice names the connector and says what to do', () => {
    const n = connectorRefusedNotice(['Plaud']);
    expect(n).toMatch(/Plaud/);
    expect(n).toMatch(/Settings → Connectors/);
    // Never a bare internal label — that is what the provider gave us and it means nothing to a person.
    expect(n).not.toMatch(/c_[0-9a-f]{8}/);
  });

  it('says nothing when nothing was dropped', () => {
    expect(connectorRefusedNotice([])).toBe('');
  });
});

describe('SQEM-572 — openaiRefusedConnectorLabels', () => {
  it('⭐ reads the label from the message OpenAI really sends', () => {
    const msg = "OpenAI API error (stream): Error retrieving tool list from MCP server: 'c_e6db0f67f1624eeeaceb5387ba20'. Http status code: 424 (Failed Dependency)";
    expect(openaiRefusedConnectorLabels(msg)).toEqual(['c_e6db0f67f1624eeeaceb5387ba20']);
  });

  it('several servers, each once', () => {
    const msg = "MCP server: 'c_a' failed; MCP server: 'c_b' failed; MCP server: 'c_a' again";
    expect(openaiRefusedConnectorLabels(msg)).toEqual(['c_a', 'c_b']);
  });

  it('⛔ an unrelated error names nothing', () => {
    expect(openaiRefusedConnectorLabels('OpenAI API error (stream): Rate limit reached for gpt-6')).toEqual([]);
    expect(openaiRefusedConnectorLabels('')).toEqual([]);
    expect(openaiRefusedConnectorLabels(undefined as unknown as string)).toEqual([]);
  });
});
