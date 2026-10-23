import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { countUsage, isClientReportable, USAGE_CHANNELS, USAGE_ACTIONS } from '../../supabase/functions/_shared/usageCounts';
import { createLibraryToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/**
 * SQEM-517 — playbook use is counted per workspace, day, channel and playbook, never per person, and
 * the count never slows down or breaks the use itself.
 */
const ROOT = resolve(__dirname, '../../');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

afterEach(() => { delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime; });

describe('what may be counted', () => {
  it('a client may report only the extension inserting a playbook', () => {
    expect(isClientReportable('extension', 'playbook_inserted')).toBe(true);
    expect(isClientReportable('mcp', 'playbook_loaded')).toBe(false);   // the server counts that itself
    expect(isClientReportable('chat', 'playbook_loaded')).toBe(false);
    expect(isClientReportable('extension', 'anything')).toBe(false);
  });
  it('the channels and actions match the CHECK constraints of the migration', () => {
    const m = readFileSync(resolve(ROOT, 'supabase/migrations/20261016190000_sqem517_usage_daily.sql'), 'utf8');
    for (const c of USAGE_CHANNELS) expect(m).toContain(`'${c}'`);
    for (const a of USAGE_ACTIONS) expect(m).toContain(`'${a}'`);
  });
  it('⛔ the table has no person in it', () => {
    const m = readFileSync(resolve(ROOT, 'supabase/migrations/20261016190000_sqem517_usage_daily.sql'), 'utf8');
    const table = m.slice(m.indexOf('create table if not exists public.usage_daily'), m.indexOf(');', m.indexOf('create table if not exists public.usage_daily')));
    expect(table).not.toMatch(/user_id|created_by|email/);
  });
});

describe('countUsage — never in the way', () => {
  it('runs after the answer (waitUntil) and never throws, even when the write fails', async () => {
    const kept: Promise<unknown>[] = [];
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => kept.push(p) };
    const failing = { rpc: () => Promise.reject(new Error('db down')) };
    expect(() => countUsage(failing, 'ws', 'mcp', 'playbook_loaded', 't')).not.toThrow();
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toBeUndefined();
  });
  it('does nothing without a workspace or a playbook', () => {
    let called = 0;
    countUsage({ rpc: async () => { called += 1; return { error: null }; } }, '', 'mcp', 'playbook_loaded', 't');
    countUsage({ rpc: async () => { called += 1; return { error: null }; } }, 'ws', 'mcp', 'playbook_loaded', '');
    expect(called).toBe(0);
  });
});

describe('chat counts a loaded playbook, without risking the answer', () => {
  const reader: any = { getTemplate: async () => ({ id: 'tpl-1', name: 'brief', contextFiles: [] }) };
  it('tells the caller which playbook was loaded', async () => {
    const seen: string[] = [];
    const rt = createLibraryToolRuntime(async () => reader, { onTemplateLoaded: id => seen.push(id) });
    await rt.execute('get_template', { name: 'brief' });
    expect(seen).toEqual(['tpl-1']);
  });
  it('⛔ a counter that throws does not cost the answer', async () => {
    const rt = createLibraryToolRuntime(async () => reader, { onTemplateLoaded: () => { throw new Error('boom'); } });
    const out = await rt.execute('get_template', { name: 'brief' });
    expect(out).toContain('tpl-1');
  });
});

describe('where the server counts', () => {
  it('MCP counts get_template after it succeeded', () => {
    expect((code('supabase/functions/mcp-server/index.ts') + '\n' + code('supabase/functions/_shared/libraryActions.ts') + '\n' + code('supabase/functions/_shared/libraryToolDefs.ts'))).toMatch(/lib\.getTemplate\([\s\S]{0,200}\)\.then\(t => \{[\s\S]{0,200}countUsage\(adminClient, workspaceId, ctx\.surface, 'playbook_loaded', t\.id\)/);
  });
  it('chat passes the counter to its tools', () => {
    // SQEM-551 — the same callback also records the id for the "Used" chips; the count must stay in it.
    expect(code('supabase/functions/chat-message/index.ts')).toMatch(/onTemplateLoaded: \(templateId\) => \{[\s\S]{0,200}countUsage\(createAdminClient\(\), workspaceId, 'chat', 'playbook_loaded', templateId\);\s*\}/);
  });
  it('record-usage: only the extension event, budget first, access with the caller\'s token, then count', () => {
    const fn = code('supabase/functions/record-usage/index.ts');
    expect(fn).toMatch(/isClientReportable\(body\?\.channel, body\?\.action\)/);
    const budget = fn.indexOf('checkRateLimit('), access = fn.indexOf("asUser.from('prompts')"), count = fn.indexOf('countUsage(admin');
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(access);
    expect(access).toBeLessThan(count);
  });
});
