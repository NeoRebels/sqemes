import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-530 — the per-call log line names the tool and carries numbers, nothing else. It exists because
 * a call that died with 546 left no log saying which tool; it must never become the place
 * where a customer's content or file names end up. `mcp-server/index.ts` cannot be imported (Deno.serve
 * at load), so it is read as text.
 */
const src = readFileSync('supabase/functions/mcp-server/index.ts', 'utf8');
const calls = [...src.matchAll(/logCall\(([^;]*)\);/g)].map(m => m[1]);

describe('SQEM-530 — [mcp-call] log line', () => {
  it('is written at the start, at the end, and on a refusal', () => {
    expect(calls.some(c => c.startsWith("'start', toolName"))).toBe(true);
    expect(calls.some(c => c.startsWith("'end', call.tool"))).toBe(true);
    expect(calls.some(c => c.startsWith("'refused'"))).toBe(true);
  });

  it('⛔ never carries arguments, a file name or content', () => {
    for (const c of calls) expect(c, c).not.toMatch(/\bargs\b|fileName|content|params|name:/);
  });

  it('only a tool the server knows is named — an unknown name stays out of the log', () => {
    const i = src.indexOf("logCall('start', toolName");
    expect(src.slice(i - 300, i)).toContain('if (TOOL_CAPABILITY[toolName]) {');
  });

  it('the start line comes before the handlers, so a worker killed mid-call still leaves it', () => {
    expect(src.indexOf("logCall('start', toolName")).toBeLessThan(src.indexOf("if (toolName === 'list_personas')"));
  });

  it("memory is the heap: rss reads 0 on Supabase's runtime", () => {
    expect(src).toContain('Deno.memoryUsage().heapUsed');
    expect(src).not.toContain('Deno.memoryUsage().rss');
  });
});
