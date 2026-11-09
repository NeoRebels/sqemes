import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  idList, accessPlan, editorsPlan, unknownIds, accessSentence, editorsSentence, normalizeTag, MAX_TAG_LENGTH,
} from '../../supabase/functions/_shared/accessTools';
import { TOOL_CAPABILITY, LIBRARY_TOOL_DEFS, SELF_HOST_HIDDEN_TOOLS } from '../../supabase/functions/_shared/libraryToolDefs';
import { chatActionDefinitions } from '../../supabase/functions/_shared/libraryTools';

/** SQEM-663 — access, editors and tags over MCP and in Chat. */

const read = (p: string) => readFileSync(p, 'utf8');
const ACTIONS = read('supabase/functions/_shared/libraryActions.ts');
const QUERIES = read('supabase/functions/_shared/libraryQueries.ts');
const MCP = read('supabase/functions/mcp-server/index.ts');
const MIGRATION = read('supabase/migrations/20261108110000_sqem663_manage_editors_for_user.sql');

describe('accessPlan — the app\'s three states (SQEM-210)', () => {
  const who = (u: string[] = [], g: string[] = []) => ({ userIds: u, groupIds: g });
  it('everyone writes no row, only_me the principal-less marker, restricted one row per principal', () => {
    expect(accessPlan('everyone', who(), true)).toEqual({ ok: true, rows: [] });
    expect(accessPlan('only_me', who(), true)).toEqual({ ok: true, rows: [{}] });
    expect(accessPlan('restricted', who(['u1'], ['g1']), true)).toEqual({ ok: true, rows: [{ user_id: 'u1' }, { group_id: 'g1' }] });
  });
  it('⛔ never "only me" over an object without an owner — it would be invisible to everyone (SQEM-240)', () => {
    const p = accessPlan('only_me', who(), false);
    expect(p.ok).toBe(false);
  });
  it('restricted without anybody named is refused, and a wrong mode is named', () => {
    expect(accessPlan('restricted', who(), true).ok).toBe(false);
    expect(accessPlan('private', who(), true)).toEqual({ ok: false, message: 'mode must be one of: everyone, only_me, restricted' });
  });
});

describe('editorsPlan — no rows means anyone who may edit (SQEM-473)', () => {
  it('anyone writes nothing, selected one row per principal, selected without anybody is refused', () => {
    expect(editorsPlan('anyone', { userIds: ['x'], groupIds: [] })).toEqual({ ok: true, rows: [] });
    expect(editorsPlan('selected', { userIds: ['u1'], groupIds: ['g1'] })).toEqual({ ok: true, rows: [{ user_id: 'u1' }, { group_id: 'g1' }] });
    expect(editorsPlan('selected', { userIds: [], groupIds: [] }).ok).toBe(false);
  });
});

describe('principals', () => {
  it('ids are strings, trimmed, unique', () => {
    expect(idList([' a ', 'a', 3, '', 'b'])).toEqual(['a', 'b']);
    expect(idList('a')).toEqual([]);
  });
  it('⛔ an id outside the workspace is refused by name, never dropped silently', () => {
    expect(unknownIds({ userIds: ['u1', 'x'], groupIds: ['g9'] }, new Set(['u1']), new Set(['g1']))).toEqual(['x', 'g9']);
  });
});

describe('what the model reads back', () => {
  it('says the new state in words, and when the caller loses sight', () => {
    expect(accessSentence('playbook', 'everyone', [], { isOwner: true, keepsSight: true })).toBe('Everyone in the workspace can now see this playbook.');
    expect(accessSentence('playbook', 'only_me', [], { isOwner: true, keepsSight: true })).toBe('Only you can now see this playbook.');
    expect(accessSentence('persona', 'restricted', ['Ana', 'the group QA'], { isOwner: false, keepsSight: false }))
      .toBe('Only Ana and the group QA can now see this persona, and its owner. You are not among them, so you will no longer see it.');
    expect(editorsSentence('playbook', 'selected', ['you', 'Ben', 'Cem'])).toBe('Only you, Ben and Cem can now change this playbook, besides its owner and the workspace admins.');
  });
  it('⛔ no apostrophe in what reaches the model from single-quoted source (SQEM-526)', () => {
    for (const s of [accessSentence('playbook', 'only_me', [], { isOwner: false, keepsSight: false }), editorsSentence('persona', 'anyone', [])]) expect(s).not.toMatch(/'/);
  });
});

describe('tags — one per playbook, as in the app', () => {
  it('trims, bounds, and tells "remove" from "unchanged"', () => {
    expect(normalizeTag('  review ')).toBe('review');
    expect(normalizeTag(undefined)).toBeUndefined();
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('x'.repeat(99))).toHaveLength(MAX_TAG_LENGTH);
  });
  it('⛔ the playbook tag is the column `prompts.tag` — `tags` was dropped and selecting it emptied list and search', () => {
    // Every select on `prompts` in the reader and the actions: no `tags` column.
    for (const src of [QUERIES, ACTIONS]) {
      const selects = [...src.matchAll(/from\('prompts'\)\s*\.select\('([^']*)'\)/g)].map(m => m[1]);
      for (const sel of selects) expect(sel.split(',').map(c => c.trim()), sel).not.toContain('tags');
    }
    expect(QUERIES).toMatch(/const tagMatches = \(t: any, tag: string \| null \| undefined\) => !tag \|\| t\.tag === tag;/);
    // A failed query is an error, not an empty library.
    expect(QUERIES).toMatch(/if \(listErr\) throw new Error/);
    expect(QUERIES).toMatch(/if \(searchErr\) throw new Error/);
  });
  it('create/update take `tag`, list/search return it and filter by it; a new tag joins the workspace list', () => {
    const props = (n: string) => Object.keys((LIBRARY_TOOL_DEFS.find(d => d.name === n)!.inputSchema as { properties: object }).properties);
    for (const n of ['create_template', 'update_template', 'list_templates', 'search_templates']) expect(props(n)).toContain('tag');
    expect(ACTIONS).toMatch(/\.\.\.\(tag \? \{ tag \} : \{\}\), \/\/ SQEM-663/);
    expect(ACTIONS).toMatch(/if \(tag !== undefined\)\s+updates\.tag\s+= tag \|\| null;/);
    expect(ACTIONS).toMatch(/if \(tag\) await ensureWorkspaceTag\(tag\);/);
    expect(QUERIES).toMatch(/canAccessTemplate\(t\.id\) && tagMatches\(t, tag\)/);
    expect(QUERIES).toMatch(/\.\.\.listFields\(t, names\),/);
  });
});

describe('the tools', () => {
  it('capabilities: list_members reads, set_access and set_editors update', () => {
    expect(TOOL_CAPABILITY.list_members).toBe('read');
    expect(TOOL_CAPABILITY.set_access).toBe('update');
    expect(TOOL_CAPABILITY.set_editors).toBe('update');
  });
  it('⛔ set_access asks the edit rule; set_editors the new owner-or-admin rule — both after the visibility gate', () => {
    const body = (n: string) => ACTIONS.slice(ACTIONS.indexOf(`if (toolName === '${n}')`), ACTIONS.indexOf("if (toolName === '", ACTIONS.indexOf(`if (toolName === '${n}')`) + 1));
    expect(body('set_access')).toMatch(/canAccessPersona\(args\.id\) : canAccessTemplate\(args\.id\)[\s\S]*mayEdit\(t\.kind, t\.objectId\)/);
    expect(body('set_editors')).toMatch(/canAccessPersona\(args\.id\) : canAccessTemplate\(args\.id\)[\s\S]*template_editors_manage_allowed/);
  });
  it('⛔ list_members gives names, never e-mail addresses', () => {
    expect(ACTIONS).toMatch(/select\('user_id, role, profiles\(name\)'\)/);
    expect(QUERIES).toMatch(/select\('user_id, profiles\(name\)'\)/);
  });
  it('self-host offers none of the three (access and editors are Cloud-only there): Chat, the MCP list and the handler', () => {
    expect(SELF_HOST_HIDDEN_TOOLS).toEqual(['set_access', 'set_editors', 'list_members']);
    const selfHosted = chatActionDefinitions('admin', { selfHosted: true }).map(d => d.name);
    for (const n of SELF_HOST_HIDDEN_TOOLS) expect(selfHosted).not.toContain(n);
    expect(chatActionDefinitions('admin').map(d => d.name)).toEqual(expect.arrayContaining(['set_access', 'set_editors', 'list_members']));
    expect(MCP).toMatch(/if \(SELF_HOSTED_INSTALL && SELF_HOST_HIDDEN_TOOLS\.includes\(t\.name\)\) return false;/);
    expect(ACTIONS).toMatch(/if \(SELF_HOSTED && SELF_HOST_HIDDEN_TOOLS\.includes\(toolName\)\) return rpcError/);
  });
  it('a member in Chat gets list_members but none of the two writes', () => {
    const names = chatActionDefinitions('member').map(d => d.name);
    expect(names).toContain('list_members');
    expect(names).not.toContain('set_access');
    expect(names).not.toContain('set_editors');
  });
});

describe('the migration', () => {
  it('⛔ the user-id forms are service-only, and the client forms call them (one rule)', () => {
    expect(MIGRATION).toMatch(/revoke all on function public\.template_editors_manage_allowed\(uuid, uuid\) from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/revoke all on function public\.persona_editors_manage_allowed\(uuid, uuid\)\s+from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/as \$function\$ select public\.template_editors_manage_allowed\(p_template_id, \(select auth\.uid\(\)\)\) \$function\$;/);
    expect(MIGRATION).toMatch(/as \$function\$ select public\.persona_editors_manage_allowed\(p_persona_id, \(select auth\.uid\(\)\)\) \$function\$;/);
  });
});
