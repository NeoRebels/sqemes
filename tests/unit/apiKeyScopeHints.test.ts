import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The checkbox list in the connection dialog is the ONLY place a person sees what a permission
 * actually hands out. It had drifted twice before this test existed, both times the same way: a tool
 * was added to `TOOL_CAPABILITY` in `mcp-server` and nobody thought of the checkbox that grants it.
 *
 * ⛔ `delete_file` was missing from `delete` (since SQEM-234) and every persona tool was missing from
 * all three (since SQEM-337/338). So "Delete templates" was quietly also handing out `delete_file`
 * and `delete_persona` — **the label promised less than the checkbox gave**, which is the direction
 * that matters.
 *
 * ⚠️ Read as TEXT, not imported: `mcp-server/index.ts` calls `Deno.serve` at module load and cannot
 * be imported into vitest. Same approach as `mcpToolCapability.test.ts`.
 */
const SERVER = readFileSync(
  resolve(__dirname, '../../supabase/functions/mcp-server/index.ts'), 'utf8',
);
const FIELDS = readFileSync(
  resolve(__dirname, '../../components/ApiKeyScopeFields.tsx'), 'utf8',
);

/** Strip comments so a tool named only in prose never counts as listed. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** tool name -> capability, straight out of the map the server actually dispatches on. */
function toolCapabilities(): Record<string, string> {
  const block = code(SERVER).match(/const TOOL_CAPABILITY[^{]*\{([\s\S]*?)\n\};/);
  expect(block, 'TOOL_CAPABILITY not found — did the map get renamed?').toBeTruthy();
  const out: Record<string, string> = {};
  for (const m of block![1].matchAll(/^\s*([a-z_]+):\s*'(read|create|update|delete)'/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** The hint string shown under one checkbox. */
function hintFor(cap: 'create' | 'update' | 'delete'): string {
  const m = code(FIELDS).match(new RegExp(`key:\\s*'${cap}'[\\s\\S]*?hint:\\s*'([^']*)'`));
  expect(m, `no hint found for '${cap}'`).toBeTruthy();
  return m![1];
}

describe('the permission checkboxes list every tool they grant (SQEM-348)', () => {
  const caps = toolCapabilities();

  it('finds a non-trivial capability map to compare against', () => {
    // Guards the guard: a regex that silently matched nothing would make every case below pass.
    expect(Object.keys(caps).length).toBeGreaterThan(15);
    expect(caps.delete_file).toBe('delete');
    expect(caps.attach_template).toBe('update');
  });

  for (const cap of ['create', 'update', 'delete'] as const) {
    it(`'${cap}' names every ${cap} tool`, () => {
      const hint = hintFor(cap);
      const expected = Object.entries(caps).filter(([, c]) => c === cap).map(([t]) => t);
      expect(expected.length, `no tools carry '${cap}' — the map cannot be right`).toBeGreaterThan(0);
      for (const tool of expected) {
        expect(hint, `'${tool}' is granted by '${cap}' but the dialog does not say so`).toContain(tool);
      }
    });

    it(`'${cap}' names nothing it does not grant`, () => {
      // The other direction, and it is not symmetry for its own sake: a hint that lists a tool the
      // checkbox does NOT hand out overstates the grant, and someone will decline a permission they
      // actually needed.
      for (const tool of hintFor(cap).split(',').map(t => t.trim()).filter(Boolean)) {
        expect(caps[tool], `the dialog lists '${tool}' under '${cap}'`).toBe(cap);
      }
    });
  }

  it('read is described as covering personas and files, not templates alone', () => {
    // `read` has no checkbox — it is the always-included line, so it cannot be compared tool by tool.
    // Pinning the wording is the most this test can honestly do, and it is what went stale.
    expect(FIELDS).toMatch(/Read templates, files &amp; personas/);
  });
});
