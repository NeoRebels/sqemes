import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-466 — the Claude path drops a refused connector instead of failing the message.
 *
 * The parser lives in `connectorRefusal.test.ts`; this file pins the wiring, because the order of
 * the two retry branches is the part that is easy to get wrong and impossible to see in a diff.
 */
const ROOT = resolve(__dirname, '../../');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const src = code(readFileSync(resolve(ROOT, 'supabase/functions/chat-message/index.ts'), 'utf8'));

/** `callClaude`'s body: from its connector list to the end of the file's next function. */
function claude(): string {
  // SQEM-572 — anchored to the function: callOpenAIResponses keeps a list of the same name now.
  const start = src.indexOf('let activeConnectors = connectors;', src.indexOf('async function callClaude('));
  expect(start, 'callClaude no longer keeps a shrinkable connector list').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\nasync function', start + 1));
}

describe('SQEM-466 — a refused connector does not kill the message', () => {
  it('⛔ the connector check runs BEFORE the function-tools check', () => {
    // `toolsWereRefused` is `status === 400 && /tool/i.test(body)` — broad, and safe only because
    // its remedy is harmless. Dropping a connector is not harmless, so the narrow match goes first.
    const b = claude();
    const refusal = b.indexOf('refusedConnectorLabels(');
    const tools = b.indexOf('toolsWereRefused(');
    expect(refusal, 'the connector branch is gone').toBeGreaterThan(-1);
    expect(tools).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(tools);
  });

  it('⛔ the retry cannot loop — the list must actually shrink first', () => {
    // Without this guard, a label we do not carry would make an identical request forever.
    expect(claude()).toMatch(/keep\.length < activeConnectors!\.length/);
  });

  it('the request is built from the shrunken list, not the original', () => {
    const b = claude();
    expect(b).toMatch(/body\.mcp_servers = activeConnectors\.map/);
    // ⚠️ A half-rename is what bites later: the timeout decision reads the same list as the body.
    expect(b).not.toMatch(/connectors: !!connectors\?\.length/);
  });

  it('⛔ the person is told, by real name', () => {
    const b = claude();
    expect(b).toMatch(/droppedConnectors\.push\(c\.displayName\)/);
    expect(b).toMatch(/connectorRefusedNotice\(droppedConnectors, locale\)/); // SQEM-604 — in the user's language
  });

  it('⚠️ displayName is carried out of the database, not derived', () => {
    // The label the provider echoes is `c_<id>`; the real name only exists on the row.
    expect(src).toMatch(/displayName: r\.name/);
    expect(src).toMatch(/\.select\('id, name, mcp_url/);
  });
});

/** `callOpenAIResponses`'s body (SQEM-572). */
function openai(): string {
  const start = src.indexOf('async function callOpenAIResponses(');
  expect(start, 'callOpenAIResponses is gone').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\nasync function', start + 1));
}

describe('SQEM-572 — the same on OpenAI Responses', () => {
  it('⛔ both failure shapes drop the connector: an HTTP error AND a failed stream', () => {
    const b = openai();
    expect(b).toMatch(/if \(dropRefused\(errText\)\) continue;/);
    expect(b).toMatch(/if \(problem && dropRefused\(problem\)\) continue;/);
  });

  it('⛔ the connector check runs BEFORE the function-tools check and before the throw', () => {
    const b = openai();
    expect(b.indexOf('dropRefused(errText)')).toBeLessThan(b.indexOf('toolsWereRefused('));
    expect(b.indexOf('dropRefused(problem)')).toBeLessThan(b.indexOf('throw new Error(problem)'));
  });

  it('⛔ the retry cannot loop — only a label we actually sent counts', () => {
    expect(openai()).toMatch(/if \(keep\.length === activeConnectors\.length\) return false;/);
  });

  it('the request and its timeout are built from the shrunken list', () => {
    const b = openai();
    expect(b).toMatch(/connectorResponsesTools\(activeConnectors\)/);
    expect(b).not.toMatch(/connectorResponsesTools\(connectors\)/);
    expect(b).not.toMatch(/connectors: !!connectors\?\.length/);
  });

  it('⛔ the person is told, by real name', () => {
    const b = openai();
    expect(b).toMatch(/droppedConnectors\.push\(c\.displayName\)/);
    expect(b).toMatch(/connectorRefusedNotice\(droppedConnectors, locale\)/); // SQEM-604 — in the user's language
  });
});
