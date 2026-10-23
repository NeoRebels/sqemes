import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIBRARY_TOOLS, CHAT_EXCLUDED_TOOLS, chatActionDefinitions, createLibraryToolRuntime, outcomeText,
  toGeminiTools, type ActionOutcome,
} from '../../supabase/functions/_shared/libraryTools';
import { LIBRARY_TOOL_DEFS, TOOL_CAPABILITY } from '../../supabase/functions/_shared/libraryToolDefs';
import {
  describeChange, addChange, normalizeLibraryChanges, changeLabel, MAX_LIBRARY_CHANGES, type LibraryChange,
} from '../../supabase/functions/_shared/libraryChanges';

/**
 * SQEM-561 — every MCP tool in sqemes Chat, by role, through the handlers MCP runs.
 * Writes go through directly, overwriting a persona is allowed, deleting is allowed — bounded by access
 * and "Who can edit".
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const WRITES = Object.entries(TOOL_CAPABILITY).filter(([, c]) => c !== 'read').map(([n]) => n);
const names = (role: string | null) => chatActionDefinitions(role).map(d => d.name);
const ID = '11111111-2222-4333-8444-555555555555';
const P_ID = '99999999-2222-4333-8444-555555555555';

describe('which tools Chat offers, by role', () => {
  it('⛔ a member is offered no write at all — and neither is a missing role', () => {
    for (const role of ['member', null, 'owner', '']) {
      expect(names(role).filter(n => WRITES.includes(n)), String(role)).toEqual([]);
    }
  });

  it('an editor and an admin are offered every write MCP has, except the two that need a byte upload', () => {
    for (const role of ['editor', 'admin']) {
      const offered = names(role);
      for (const w of WRITES.filter(n => !CHAT_EXCLUDED_TOOLS.includes(n))) expect(offered, `${role}: ${w}`).toContain(w);
    }
  });

  it('⛔ create_upload_url and finalize_upload are never offered — a chat model has no bytes to PUT', () => {
    expect(CHAT_EXCLUDED_TOOLS).toEqual(['create_upload_url', 'finalize_upload']);
    for (const role of ['admin', 'editor', 'member']) {
      for (const n of CHAT_EXCLUDED_TOOLS) expect(names(role)).not.toContain(n);
    }
  });

  it('every other MCP tool is reachable in Chat for an admin, none twice', () => {
    const all = [...LIBRARY_TOOLS.map(t => t.name), ...names('admin')];
    expect(new Set(all).size).toBe(all.length);
    const mcp = LIBRARY_TOOL_DEFS.map(d => d.name).filter(n => !CHAT_EXCLUDED_TOOLS.includes(n));
    expect([...all].sort()).toEqual([...mcp].sort());
  });

  it('a member still gets the extra reads (list_templates, list_files, download_skill)', () => {
    expect(names('member').sort()).toEqual(['download_skill', 'list_files', 'list_templates']);
  });
});

describe('the schemas Chat sends — what Gemini accepts', () => {
  const defs = [...LIBRARY_TOOLS, ...chatActionDefinitions('admin')];

  it('⛔ no schema keyword Gemini rejects', () => {
    const s = JSON.stringify(defs);
    for (const k of ['additionalProperties', '$schema', 'oneOf', 'anyOf', 'allOf', '$ref']) expect(s).not.toContain(k);
  });

  it('⛔ every object schema names its properties (Gemini: "should be non-empty for OBJECT type")', () => {
    const empty: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object' && path.includes('.') && !(o.properties && Object.keys(o.properties as object).length)) empty.push(path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    for (const d of defs) walk(d.parameters, d.name);
    expect(empty).toEqual([]);
  });

  it('Gemini gets one tool object holding all of them', () => {
    expect(toGeminiTools(defs)[0].functionDeclarations).toHaveLength(defs.length);
  });
});

describe('the runtime with actions', () => {
  function setup(outcomes: Record<string, ActionOutcome>, role = 'editor') {
    let readers = 0;
    const ran: string[] = [];
    const changes: LibraryChange[] = [];
    const rt = createLibraryToolRuntime(async () => { readers += 1; return {} as never; }, {
      actions: {
        definitions: chatActionDefinitions(role),
        run: async (name) => { ran.push(name); return outcomes[name]; },
      },
      onChange: c => changes.push(c),
    });
    return { rt, ran, changes, readers: () => readers };
  }
  const ok = (o: unknown): ActionOutcome => ({ ok: true, result: { content: [{ type: 'text', text: JSON.stringify(o) }] } });

  it('⛔ a write a member was not offered is "unknown" — it never reaches a handler', async () => {
    const { rt, ran } = setup({}, 'member');
    const out = await rt.execute('delete_template', { id: ID });
    expect(JSON.parse(out).error).toMatch(/Unknown tool/);
    expect(ran).toEqual([]);
  });

  it('⛔ a write drops the reader, so the next call sees what was just created', async () => {
    const { rt, readers } = setup({
      create_template: ok({ id: ID, title: 'Brief', kind: 'prompt' }),
      list_files: ok([]),
    });
    await rt.execute('create_template', { kind: 'prompt', title: 'Brief', content: 'x' });
    await rt.execute('list_files', {});
    await rt.execute('list_files', {});
    expect(readers()).toBe(2); // one before the write, one after it — and reads reuse it
  });

  it('a successful write is reported as a change; a refusal is not', async () => {
    const { rt, changes } = setup({
      create_template: ok({ id: ID, title: 'Brief', kind: 'prompt' }),
      delete_template: { ok: false, code: -32602, message: 'You may use this playbook but not change it' },
    });
    await rt.execute('create_template', {});
    const refused = await rt.execute('delete_template', { id: ID });
    expect(JSON.parse(refused).error).toMatch(/not change it/);
    expect(changes).toEqual([{ action: 'created', kind: 'prompt', id: ID, title: 'Brief' }]);
  });

  it('the definitions the provider sees are the five plus the role\'s', () => {
    const { rt } = setup({}, 'admin');
    expect(rt.definitions.map(d => d.name)).toEqual([...LIBRARY_TOOLS.map(t => t.name), ...names('admin')]);
  });

  it('outcomeText: text parts joined, an error as {error}', () => {
    expect(outcomeText({ ok: true, result: { content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] } })).toBe('a\nb');
    expect(JSON.parse(outcomeText({ ok: false, code: 1, message: 'no' }))).toEqual({ error: 'no' });
  });
});

describe('the card under the answer', () => {
  it('reads each write from the tool\'s own answer', () => {
    expect(describeChange('create_template', {}, JSON.stringify({ id: ID, title: 'T', kind: 'skill' }))).toEqual({ action: 'created', kind: 'skill', id: ID, title: 'T' });
    expect(describeChange('update_persona', { title: 'New' }, JSON.stringify({ updated: true, id: P_ID, fields: ['title'] }))).toEqual({ action: 'updated', kind: 'persona', id: P_ID, title: 'New' });
    expect(describeChange('attach_template', { persona_id: P_ID }, JSON.stringify({ attached: true, persona: 'Sales' }))).toEqual({ action: 'updated', kind: 'persona', id: P_ID, title: 'Sales' });
    expect(describeChange('delete_file', {}, JSON.stringify({ deleted: true, id: ID, name: 'a.md' }))).toEqual({ action: 'deleted', kind: 'file', id: ID, title: 'a.md' });
  });

  it('a blocked delete_file, a read and garbage change nothing', () => {
    expect(describeChange('delete_file', {}, JSON.stringify({ deleted: false, blocked: true }))).toBeNull();
    expect(describeChange('list_files', {}, '[]')).toBeNull();
    expect(describeChange('create_template', {}, 'not json')).toBeNull();
    expect(describeChange('create_template', {}, JSON.stringify({ id: 'not-a-uuid', kind: 'prompt' }))).toBeNull();
  });

  it('the same object twice is one line: create stays create, delete wins', () => {
    const l: LibraryChange[] = [];
    addChange(l, { action: 'created', kind: 'prompt', id: ID, title: 'A' });
    addChange(l, { action: 'updated', kind: 'prompt', id: ID, title: 'B' });
    expect(l).toEqual([{ action: 'created', kind: 'prompt', id: ID, title: 'B' }]);
    addChange(l, { action: 'deleted', kind: 'prompt', id: ID, title: '' });
    expect(l).toEqual([{ action: 'deleted', kind: 'prompt', id: ID, title: 'B' }]);
  });

  it('the stored list is parsed defensively and capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ action: 'created', kind: 'file', id: `${String(i).padStart(8, '0')}-2222-4333-8444-555555555555`, title: 'f' }));
    expect(normalizeLibraryChanges(many)).toHaveLength(MAX_LIBRARY_CHANGES);
    expect(normalizeLibraryChanges([{ action: 'hacked', kind: 'prompt', id: ID }, null, 'x'])).toEqual([]);
    expect(normalizeLibraryChanges('nope')).toEqual([]);
  });

  it('⛔ a shared chat never names what the viewer cannot open', () => {
    const c: LibraryChange = { action: 'updated', kind: 'prompt', id: ID, title: 'Secret plan' };
    expect(changeLabel(c, undefined)).toEqual({ title: 'a playbook you cannot open', linked: false });
    expect(changeLabel(c, 'Current title')).toEqual({ title: 'Current title', linked: true });
    expect(changeLabel({ ...c, action: 'deleted' }, undefined)).toEqual({ title: 'Secret plan', linked: false });
  });

  it('the migration caps the list at the same number', () => {
    const sql = read('supabase/migrations/20261022200000_sqem561_chat_library_changes.sql');
    expect(sql).toMatch(/role = 'assistant'/);
    expect(sql).toContain(`jsonb_array_length(library_changes) <= ${MAX_LIBRARY_CHANGES}`);
  });
});

describe('wiring', () => {
  const chat = code(read('supabase/functions/chat-message/index.ts'));
  const actions = code(read('supabase/functions/_shared/libraryActions.ts'));

  it('chat-message runs the SHARED handlers as the chat user, with the role from the membership check', () => {
    expect(chat).toMatch(/role: \(membership as \{ role\?: string \}\)\.role \?\? null/);
    expect(chat).toMatch(/definitions: chatActionDefinitions\(role\)/);
    expect(chat).toMatch(/runLibraryTool\(\s*\{ adminClient: createAdminClient\(\), workspaceId, userId, role, lib, surface: 'chat' \}/);
  });

  it('⛔ the shared handlers refuse a write without the role before any handler runs', () => {
    const gate = actions.indexOf("if (requiredCap !== 'read' && !mcpUserManagesContent)");
    expect(gate).toBeGreaterThan(-1);
    expect(actions).toMatch(/const mcpUserManagesContent = ctx\.role === 'admin' \|\| ctx\.role === 'editor';/);
    expect(gate).toBeLessThan(actions.indexOf("if (toolName === 'list_personas')"));
  });

  it('the changes ride on the result broadcast, beside the loaded ids', () => {
    expect(chat).toMatch(/libraryChanges\.length \? \{ libraryChanges \} : \{\}/);
  });
});
