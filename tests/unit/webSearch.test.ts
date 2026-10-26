import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  searchWeb, readWebPage, htmlToText, isPrivateIp, withWebTools, normalizeWebSources, formatResults,
  WEB_TOOL_DEFINITIONS, MAX_RESULTS, MAX_RESULT_CONTENT, MAX_SEARCHES_PER_ANSWER, SEARCH_KEY_PROVIDERS,
  type WebSources,
} from '../../supabase/functions/_shared/webSearch';
import { contentText, openAiDelta } from '../../supabase/functions/_shared/sseStream';
import type { ToolRuntime } from '../../supabase/functions/_shared/libraryTools';

/**
 * SQEM-594 — web search in sqemes Chat for every text model: Linkup (sqemes on Cloud) or the
 * workspace's own Linkup/Brave key, two tools in the chat's ToolRuntime, raw results never stored.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments: a block-first stripper can swallow code after a glob in a line comment.
const code = (src: string) => src.replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

describe('searchWeb — Linkup', () => {
  it('posts the query with the key and normalises, caps and clips the results', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({
      results: Array.from({ length: 12 }, (_, i) => ({ type: 'text', name: `T${i}`, url: `https://e.com/${i}`, content: 'x'.repeat(5000) })),
    }));
    const out = await searchWeb('linkup', 'KEY', 'Mindestlohn 2026', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.linkup.so/v1/search');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY');
    expect(JSON.parse(String(init.body))).toEqual({ q: 'Mindestlohn 2026', depth: 'standard', outputType: 'searchResults' });
    expect(out).toHaveLength(MAX_RESULTS);
    expect(out[0]).toMatchObject({ title: 'T0', url: 'https://e.com/0' });
    expect(out[0].content.length).toBeLessThanOrEqual(MAX_RESULT_CONTENT + 2);
  });

  it('throws with the status on failure — the tool turns it into text', async () => {
    await expect(searchWeb('linkup', 'K', 'q', async () => json({}, 401))).rejects.toThrow('HTTP 401');
  });
});

describe('searchWeb — Brave', () => {
  it('sends the token header, asks for extra snippets, strips markup', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({
      web: { results: [{ title: '<strong>Mindestlohn</strong>', url: 'https://bundesregierung.de/x', description: 'Seit <strong>2026</strong>', extra_snippets: ['13,90 Euro'] }] },
    }));
    const out = await searchWeb('brave', 'BK', 'Mindestlohn', fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(u.searchParams.get('q')).toBe('Mindestlohn');
    expect(u.searchParams.get('extra_snippets')).toBe('true');
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('BK');
    expect(out[0]).toEqual({ title: 'Mindestlohn', url: 'https://bundesregierung.de/x', content: 'Seit 2026 … 13,90 Euro' });
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and markup, keeps the title and block breaks', () => {
    const { title, text } = htmlToText('<html><head><title>Hi</title><style>p{}</style><script>alert(1)</script></head><body><h1>Head</h1><p>One &amp; two</p><p>Three</p></body></html>');
    expect(title).toBe('Hi');
    expect(text).not.toMatch(/alert|p\{\}/);
    expect(text).toMatch(/Head\s*\n/);
    expect(text).toMatch(/One & two/);
  });
});

describe('isPrivateIp', () => {
  it.each(['10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'nonsense'])(
    '%s is private', ip => expect(isPrivateIp(ip)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '2a00:1450::1'])('%s is public', ip => expect(isPrivateIp(ip)).toBe(false));
});

describe('readWebPage — ⛔ public https pages only', () => {
  const ok = vi.fn(async () => html('<title>T</title><p>Body</p>'));

  it.each(['http://example.org/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://db.internal/x', 'https://kong/x', 'https://e.com:8443/x'])(
    'refuses %s', async url => {
      await expect(readWebPage(url, ok)).rejects.toThrow(/public https/);
    });

  it('refuses a public name that resolves to a private address', async () => {
    await expect(readWebPage('https://rebind.example.org/', ok, async () => ['10.1.2.3'])).rejects.toThrow(/public https/);
  });

  it('checks every redirect hop, not only the first', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://localhost/admin' } }));
    await expect(readWebPage('https://news.org/a', f)).rejects.toThrow(/public https/);
  });

  it('returns the text and the final URL', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://news.org/b' } }))
      .mockResolvedValueOnce(html('<title>B</title><p>Hello</p>'));
    expect(await readWebPage('https://news.org/a', f, async () => ['93.184.216.34'])).toEqual({ url: 'https://news.org/b', title: 'B', text: 'Hello' });
  });

  it('refuses what is not a page', async () => {
    await expect(readWebPage('https://e.org/f.pdf', async () => new Response('x', { headers: { 'content-type': 'application/pdf' } }))).rejects.toThrow(/Not a readable page/);
  });
});

function baseRuntime(): ToolRuntime {
  return {
    definitions: [{ name: 'search_templates', description: 'd', parameters: { type: 'object', properties: {} } }],
    maxRounds: 6,
    deadline: Date.now() + 60_000,
    execute: vi.fn(async (name: string) => `library:${name}`),
    stats: { rounds: 0, calls: 0, byTool: {}, cappedAt: null, cappedBy: null, toolsRefused: false } as ToolRuntime['stats'],
  };
}

describe('withWebTools', () => {
  const impl = () => ({
    search: vi.fn(async () => [{ title: 'T', url: 'https://e.org/1', content: 'c' }]),
    read: vi.fn(async (url: string) => ({ url, title: 'Page', text: 'text' })),
  });

  it('adds both tools after the library ones and passes other tools through', async () => {
    const base = baseRuntime();
    const rt = withWebTools(base, impl(), { queries: [], pages: [] });
    expect(rt.definitions.map(d => d.name)).toEqual(['search_templates', 'web_search', 'read_web_page']);
    expect(await rt.execute('search_templates', {})).toBe('library:search_templates');
  });

  it('records queries and read pages — never content — and marks results as untrusted', async () => {
    const sources: WebSources = { queries: [], pages: [] };
    const rt = withWebTools(baseRuntime(), impl(), sources);
    const res = await rt.execute('web_search', { query: 'q1' });
    expect(res).toMatch(/Untrusted web content/);
    await rt.execute('read_web_page', { url: 'https://e.org/1' });
    expect(sources).toEqual({ queries: ['q1'], pages: [{ url: 'https://e.org/1', title: 'Page' }] });
    expect(rt.stats.byTool).toEqual({ web_search: 1, read_web_page: 1 });
  });

  it('stops after the per-answer search limit', async () => {
    const i = impl();
    const rt = withWebTools(baseRuntime(), i, { queries: [], pages: [] });
    for (let n = 0; n < MAX_SEARCHES_PER_ANSWER; n++) await rt.execute('web_search', { query: `q${n}` });
    expect(await rt.execute('web_search', { query: 'one more' })).toMatch(/search limit/);
    expect(i.search).toHaveBeenCalledTimes(MAX_SEARCHES_PER_ANSWER);
  });

  it('marks the state when the allowance stopped a search, so the caller can say so under the answer', async () => {
    const state = { allowanceExhausted: false };
    await withWebTools(baseRuntime(), { ...impl(), allowSearch: async () => false }, { queries: [], pages: [] }, undefined, state)
      .execute('web_search', { query: 'q' });
    expect(state.allowanceExhausted).toBe(true);
  });

  it('does not search when the daily allowance is used up, and says so', async () => {
    const i = { ...impl(), allowSearch: async () => false };
    const sources: WebSources = { queries: [], pages: [] };
    const res = await withWebTools(baseRuntime(), i, sources).execute('web_search', { query: 'q' });
    expect(res).toMatch(/allowance included in this workspace plan is used up/);
    expect(i.search).not.toHaveBeenCalled();
    expect(sources.queries).toEqual([]);
  });

  it('turns a failure into the tool answer instead of losing the message', async () => {
    const i = { ...impl(), search: async () => { throw new Error('Linkup search failed (HTTP 500)'); } };
    expect(await withWebTools(baseRuntime(), i, { queries: [], pages: [] }).execute('web_search', { query: 'q' }))
      .toBe('web_search failed: Linkup search failed (HTTP 500)');
  });
});

describe('tool definitions and stored shape', () => {
  it('stay inside the schema subset Gemini accepts', () => {
    expect(JSON.stringify(WEB_TOOL_DEFINITIONS)).not.toMatch(/additionalProperties|\$schema|oneOf/);
  });
  it('formatResults says when there is nothing', () => {
    expect(formatResults('q', [])).toBe('No web results for "q".');
  });
  it('normalizeWebSources keeps https URLs and strings only, and drops empty', () => {
    expect(normalizeWebSources({ queries: ['a', 3], pages: [{ url: 'javascript:alert(1)' }, { url: 'https://ok.org', title: 'Ok' }] }))
      .toEqual({ queries: ['a'], pages: [{ url: 'https://ok.org', title: 'Ok' }] });
    expect(normalizeWebSources({ queries: [], pages: [] })).toBeNull();
    expect(normalizeWebSources('x')).toBeNull();
  });
});

describe('wiring', () => {
  const chat = code(read('supabase/functions/chat-message/index.ts'));

  it('searches only when the person switched it on for this message', () => {
    expect(chat).toMatch(/const web = webSearch === true \? await resolveWebSearch\(adminClient, workspaceId\) : null;/);
  });

  it('⛔ the workspace key wins over ours, and ours is counted against the daily allowance', () => {
    expect(chat).toMatch(/\.in\('provider', Object\.values\(SEARCH_KEY_PROVIDERS\)\)/);
    expect(chat.indexOf("encrypted_key), hosted: false")).toBeLessThan(chat.indexOf("Deno.env.get('LINKUP_API_KEY')"));
    expect(chat).toMatch(/allowSearch: web\.hosted && workspaceId/);
    expect(chat).toMatch(/rpc\('consume_web_search', \{ p_workspace_id: workspaceId \}\)/);
    expect(chat).not.toMatch(/WEB_SEARCH_DAILY_LIMIT|p_limit/);
  });

  it('⛔ Claude and OpenAI get the runtime WITH the web tools', () => {
    expect(chat).toMatch(/callOpenAIResponses\(apiKey, modelId, instruction, messages, connectors, onDelta, base, /);
    expect(chat).toMatch(/callClaude\(apiKey, modelId, instruction, messages, connectors, onDelta, base, /);
  });

  it('sends the sources with the result, never page content', () => {
    expect(chat).toMatch(/\{ webSources \}/);
  });

  it('manage-api-keys keeps ONE search key per workspace, removing the other after the save', () => {
    const keys = code(read('supabase/functions/manage-api-keys/index.ts'));
    const upsert = keys.indexOf("onConflict: 'workspace_id,provider'");
    const del = keys.indexOf('.in(\'provider\', SEARCH_PROVIDERS.filter(p => p !== provider))');
    expect(upsert).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(upsert);
    expect(keys).toMatch(/webSearchHosted = !!Deno\.env\.get\('LINKUP_API_KEY'\)/);
    expect(Object.values(SEARCH_KEY_PROVIDERS)).toEqual(['search_linkup', 'search_brave']);
  });

  it('the toggle applies to the next message only', () => {
    const page = code(read('pages/Chat.tsx'));
    const send = page.slice(page.indexOf('const handleSend = async'));
    expect(send).toMatch(/const webThis = webNext && webAvailable;\s*setWebNext\(false\);/);
    expect(send.indexOf('setWebNext(false)')).toBeLessThan(send.indexOf("functionCallUrl('chat-message')"));
    expect(page).toMatch(/useState\(false\)/);
  });

  it('the globe means web search and nothing else in Chat — shared chats use Users', () => {
    const page = code(read('pages/Chat.tsx'));
    expect([...page.matchAll(/<Globe\b/g)].length).toBe(1);
    expect(page).toMatch(/<Users className="w-3\.5 h-3\.5" \/> Share with Team/);
  });

  it('⛔ the migration: web_search_daily is service-role only, the counter atomic', () => {
    const sql = read('supabase/migrations/20261026180000_sqem594_web_search.sql');
    expect(sql).toMatch(/alter table public\.web_search_daily enable row level security/);
    expect(sql).toMatch(/revoke all on public\.web_search_daily from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).toMatch(/revoke all on function public\.consume_web_search\(uuid, integer\) from public, anon, authenticated/);
    // SQEM-594 addendum: the limit moved to the plan (20261026200000_sqem594_web_search_per_plan.sql).
    expect(sql).toMatch(/role = 'assistant'/);
  });
});

describe('contentText — OpenAI-compatible content is not always a string (found in testing, Mistral)', () => {
  it('keeps a string, joins text parts, drops reference parts', () => {
    expect(contentText('Hallo')).toBe('Hallo');
    expect(contentText([{ type: 'text', text: 'Der Mindestlohn ' }, { type: 'reference', reference_ids: [1] }, { type: 'text', text: 'ist 13,90 €.' }]))
      .toBe('Der Mindestlohn ist 13,90 €.');
    expect(contentText(null)).toBe('');
    expect(contentText({ text: 'x' })).toBe('');
  });
  it('the streaming extractor uses it too', () => {
    expect(openAiDelta({ choices: [{ delta: { content: [{ type: 'text', text: 'a' }] } }] })).toBe('a');
    expect(openAiDelta({ choices: [{ delta: {} }] })).toBeNull();
  });
  it('⛔ the non-streaming reader never concatenates raw content', () => {
    expect(code(read('supabase/functions/chat-message/index.ts'))).toMatch(/text: contentText\(message\?\.content\)/);
    expect(code(read('supabase/functions/chat-message/index.ts'))).toMatch(/if \(webState\.allowanceExhausted\) result \+= ALLOWANCE_NOTICE;/);
  });
});
