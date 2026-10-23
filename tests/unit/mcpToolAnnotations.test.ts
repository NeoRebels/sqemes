import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toolAnnotations, type ToolCapability } from '../../supabase/functions/_shared/toolAnnotations';

/**
 * SQEM-523 — every MCP tool declares a title and hints, and the hints come from the capability that
 * gates the tool. MCP client guidelines ask for them; until SQEM-523 none of the 21 tools had any.
 * `mcp-server/index.ts` cannot be imported (Deno.serve at load), so the tool list is read as text,
 * the same way `mcpToolCapability.test.ts` does it.
 */
// SQEM-561 — the definitions and the capability map moved to `_shared/libraryActions.ts`, shared with Chat.
const SRC = readFileSync(resolve(process.cwd(), 'supabase/functions/mcp-server/index.ts'), 'utf8')
  + '\n' + readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/libraryActions.ts'), 'utf8')
  + '\n' + readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/libraryToolDefs.ts'), 'utf8');
const LIST = SRC.slice(SRC.indexOf('export const LIBRARY_TOOL_DEFS = ['), SRC.indexOf('\n];', SRC.indexOf('export const LIBRARY_TOOL_DEFS = [')));
const capMap = SRC.slice(SRC.indexOf('const TOOL_CAPABILITY'), SRC.indexOf('};', SRC.indexOf('const TOOL_CAPABILITY')));
const CAPS = Object.fromEntries([...capMap.matchAll(/^\s+(\w+):\s+'(read|create|update|delete)'/gm)].map(m => [m[1], m[2] as ToolCapability]));
const TOOLS = [...LIST.matchAll(/^ {4}name: '(\w+)',\n {4}(title: '([^']+)',)?/gm)].map(m => ({ name: m[1], title: m[3] }));

describe('SQEM-523 — every tool has a title', () => {
  it('all tools in tools/list, none without one', () => {
    expect(TOOLS.length).toBe(Object.keys(CAPS).length);
    expect(TOOLS.filter(t => !t.title).map(t => t.name)).toEqual([]);
  });

  it('titles are for people: "playbook", never "template" (SQEM-394)', () => {
    expect(TOOLS.filter(t => /template/i.test(t.title!)).map(t => t.name)).toEqual([]);
  });

  it('tools/list hands every visible tool its annotations', () => {
    expect(SRC).toMatch(/visibleTools\.map\(\(t\) => \(\{ \.\.\.t, annotations: toolAnnotations\(t\.name, TOOL_CAPABILITY\[t\.name\], t\.title\) \}\)\)/);
  });
});

describe('SQEM-523 — hints follow the gate', () => {
  it('⛔ read tools are read-only; every write is not, and update/delete are destructive', () => {
    for (const [name, cap] of Object.entries(CAPS)) {
      const a = toolAnnotations(name, cap, 'x');
      expect(a.readOnlyHint, name).toBe(cap === 'read');
      expect(a.destructiveHint, name).toBe(cap === 'update' || cap === 'delete');
    }
  });

  it('the destructive ones by name, so a changed capability shows up here', () => {
    const destructive = Object.entries(CAPS).filter(([n, c]) => toolAnnotations(n, c, 'x').destructiveHint).map(([n]) => n).sort();
    expect(destructive).toEqual(['attach_template', 'delete_file', 'delete_persona', 'delete_template', 'detach_template', 'update_persona', 'update_template']);
  });

  it('the two named exceptions: finalize_upload is idempotent, import_skill_from_url reaches outside', () => {
    expect(toolAnnotations('finalize_upload', 'create', 'x').idempotentHint).toBe(true);
    expect(toolAnnotations('create_template', 'create', 'x').idempotentHint).toBe(false);
    expect(Object.keys(CAPS).filter(n => toolAnnotations(n, CAPS[n], 'x').openWorldHint)).toEqual(['import_skill_from_url']);
  });
});

describe('SQEM-524 — read_context_file points at its documentation', () => {
  it('the description ends with the help-centre link (a reference to the docs the parameters are explained in)', () => {
    const def = LIST.slice(LIST.indexOf("name: 'read_context_file'"), LIST.indexOf("name: 'download_skill'"));
    expect(def).toContain('Read only the files the task actually needs.\\n\\nDocs: https://help.sqemes.com/en/articles/54-how-do-i-connect-sqemes-to-claude-desktop-or-another-mcp-client');
  });
});
