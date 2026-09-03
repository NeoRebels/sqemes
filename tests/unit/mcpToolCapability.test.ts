import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-332 — the two halves of the MCP tool surface must name the same tools.
 *
 * `tools/list` builds an array of tool definitions; `TOOL_CAPABILITY` says which permission each
 * one needs. Nothing connected them except a developer remembering, and when the persona tools were
 * added to the array and not to the map, the omission failed in **both** directions at once:
 *
 *   * `tools/list` filters on `scopes.includes(TOOL_CAPABILITY[name])` → `undefined` → the tool was
 *     **never advertised**, which is how it was eventually noticed (a user asked where it was);
 *   * `tools/call` guarded with `if (requiredCap && …)` → falsy → the scope check was **skipped
 *     entirely**, which nobody would have noticed, because skipping a check looks like success.
 *
 * ⚠️ **This test reads the source file as text rather than importing it.** `mcp-server/index.ts`
 * calls `Deno.serve` at module load, so it cannot be imported into vitest at all — and a test that
 * needs a stand-in for the thing it is testing tests the stand-in. Reading the file is cruder and
 * checks the real artefact.
 */

// ⚠️ Resolved from the working directory, not from `import.meta.url`: under the jsdom environment
// vitest hands this file a non-`file:` URL, and `fileURLToPath` throws before a single test runs.
// Vitest always runs from the repository root.
const SRC = readFileSync(resolve(process.cwd(), 'supabase/functions/mcp-server/index.ts'), 'utf8');

/** The keys of the `TOOL_CAPABILITY` record. */
function capabilityNames(): string[] {
  const block = SRC.match(/const TOOL_CAPABILITY: Record<string, Capability> = \{([\s\S]*?)\n\};/);
  expect(block, 'TOOL_CAPABILITY block not found — did the declaration change?').toBeTruthy();
  return [...block![1].matchAll(/^\s{2}([a-z_]+):\s*'(read|create|update|delete)'/gm)].map(m => m[1]);
}

/**
 * The `name:` of every tool definition in the `tools/list` array.
 *
 * Anchored on the eight-space indentation the array's entries use, so `serverInfo.name` and the
 * `name` properties inside an `inputSchema` cannot be mistaken for tools.
 */
function advertisedNames(): string[] {
  const start = SRC.indexOf("if (method === 'tools/list')");
  const end = SRC.indexOf('return rpcResult(id, { tools: visibleTools });');
  expect(start, 'tools/list branch not found').toBeGreaterThan(-1);
  expect(end, 'tools/list return not found').toBeGreaterThan(start);
  const block = SRC.slice(start, end);
  return [...block.matchAll(/^ {8}name: '([a-z_]+)',$/gm)].map(m => m[1]);
}

describe('MCP tool surface', () => {
  it('advertises at least the tools we know shipped', () => {
    const advertised = advertisedNames();
    expect(advertised).toContain('list_templates');
    expect(advertised).toContain('list_personas');
    expect(advertised).toContain('get_persona');
    expect(advertised.length).toBeGreaterThanOrEqual(14);
  });

  it('gives every advertised tool a capability', () => {
    const missing = advertisedNames().filter(n => !capabilityNames().includes(n));
    // ⛔ A tool missing here is invisible in tools/list AND ungated in tools/call.
    expect(missing, `tools missing from TOOL_CAPABILITY: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no capability entry for a tool that is not advertised', () => {
    const orphans = capabilityNames().filter(n => !advertisedNames().includes(n));
    // Less dangerous, but it means the map describes a tool that no longer exists — the next
    // person reading it would look for one.
    expect(orphans, `capabilities without a tool: ${orphans.join(', ')}`).toEqual([]);
  });

  it('refuses an unknown tool instead of waving it through', () => {
    // The fix that matters: `if (!requiredCap) return rpcError(...)`. Pinned as text because the
    // module cannot be imported — if this shape changes, the guard must be re-read, not assumed.
    expect(SRC).toMatch(/if \(!requiredCap\) \{\s*\n\s*return rpcError\(id, -32601/);
  });
});
