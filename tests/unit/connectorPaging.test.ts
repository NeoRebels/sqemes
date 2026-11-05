import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  clip, pageJson, shopifyPage, shopifyCursor, graphCursorPath, graphPage, searchOffset,
} from '../../supabase/functions/_shared/connectorPaging';
// SQEM-656 — the export prunes the Cloud-only servers and stubs the app tiles: strict here, silent there
// (the pattern from PRODUCTION_PROMOTION → the self-host cut, step 7).
const IN_PRIVATE_REPO = existsSync('scripts/build-public-export.sh');

/**
 * SQEM-640 — the servers sqemes runs itself returned the first 25–50 entries of a list and nothing
 * else. A customer (2026-11-03): a monthly Shopify analysis saw at most the 25 newest orders of a filter.
 */
describe('SQEM-640 — one page shape for every list tool', () => {
  it('`nextCursor` only when there is more', () => {
    expect(JSON.parse(pageJson([1, 2], 'abc'))).toEqual({ items: [1, 2], nextCursor: 'abc' });
    expect(JSON.parse(pageJson([1, 2], null))).toEqual({ items: [1, 2] });
  });

  it('clip keeps a limit inside its bounds', () => {
    expect(clip(undefined, 10, 50)).toBe(10);
    expect(clip(500, 10, 50)).toBe(50);
    expect(clip(0, 10, 50)).toBe(1);
  });
});

describe('SQEM-640 — Shopify connections', () => {
  it('reads nodes and the end cursor, but only when there is a next page', () => {
    const conn = { edges: [{ node: { id: 'a' } }, { node: { id: 'b' } }], pageInfo: { hasNextPage: true, endCursor: 'eyJsYXN0X2lkIjo' } };
    expect(shopifyPage(conn)).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'eyJsYXN0X2lkIjo' });
    expect(shopifyPage({ ...conn, pageInfo: { hasNextPage: false, endCursor: 'x' } }).nextCursor).toBeNull();
    expect(shopifyPage(undefined)).toEqual({ items: [], nextCursor: null });
  });

  it('a cursor is passed through only when it looks like one', () => {
    expect(shopifyCursor(undefined)).toBeNull();
    expect(shopifyCursor('')).toBeNull();
    expect(shopifyCursor('eyJsYXN0X2lkIjo2Nzg5LCJsYXN0X3ZhbHVlIjoiMjAyNi0xMC0zMSJ9')).toBe('eyJsYXN0X2lkIjo2Nzg5LCJsYXN0X3ZhbHVlIjoiMjAyNi0xMC0zMSJ9');
    expect(() => shopifyCursor('"){ shop { name } }')).toThrow(/Invalid cursor/);
    expect(() => shopifyCursor(42)).toThrow(/Invalid cursor/);
  });

  it.skipIf(!IN_PRIVATE_REPO)('the server asks for pages, counts, and keeps a page under our client\'s result bound', () => {
    const src = readFileSync('supabase/functions/mcp-shopify/index.ts', 'utf8');
    for (const c of ['products', 'orders', 'customers']) {
      expect(src).toMatch(new RegExp(`${c}\\(first:\\$n,after:\\$after,`));
    }
    expect([...src.matchAll(/pageInfo\{hasNextPage endCursor\}/g)]).toHaveLength(3);
    expect([...src.matchAll(/cursor: CURSOR_PROPERTY/g)]).toHaveLength(3);
    expect(src).toMatch(/name: 'count_orders'/);
    expect(src).toMatch(/ordersCount\(query:\$q\)\{count precision\}/);
    expect(src).toMatch(/const PAGE_MAX = 50;/);
    expect(src).not.toMatch(/clip\(args\.limit, 10, 25\)/);
  });
});

describe('SQEM-640 — a Microsoft cursor is a URL our server calls with the customer\'s token', () => {
  const next = 'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=a&$skiptoken=XYZ';

  it('accepts Graph\'s own nextLink and returns the path to call', () => {
    expect(graphCursorPath(undefined, '/me/calendarView')).toBeNull();
    expect(graphCursorPath(next, '/me/calendarView')).toBe('/me/calendarView?startDateTime=a&$skiptoken=XYZ');
    // Graph may write the link in canonical form; the kind of list is what must match.
    expect(graphCursorPath('https://graph.microsoft.com/v1.0/users/1234/messages?$skip=10', '/me/messages')).toBe('/users/1234/messages?$skip=10');
    expect(graphCursorPath("https://graph.microsoft.com/v1.0/me/drive/root/search(q='x')?$skiptoken=1", "/me/drive/root/search(q='x')")).toContain('$skiptoken=1');
  });

  it('⛔ never another host, never another version, never another kind of list', () => {
    expect(() => graphCursorPath('https://evil.example/v1.0/me/calendarView', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('https://graph.microsoft.com.evil.example/v1.0/me/calendarView', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('https://user:pw@graph.microsoft.com/v1.0/me/calendarView', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('http://graph.microsoft.com/v1.0/me/calendarView', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('https://graph.microsoft.com/beta/me/calendarView', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('https://graph.microsoft.com/v1.0/me/messages', '/me/calendarView')).toThrow(/Invalid cursor/);
    expect(() => graphCursorPath('not a url', '/me/calendarView')).toThrow(/Invalid cursor/);
  });

  it('a page carries the nextLink as its cursor', () => {
    const out = JSON.parse(graphPage({ value: [{ id: 1 }], '@odata.nextLink': next }, (x: any) => x.id));
    expect(out).toEqual({ items: [1], nextCursor: next });
    expect(JSON.parse(graphPage({ value: [] }, (x: any) => x))).toEqual({ items: [] });
  });

  it('Microsoft Search pages by offset', () => {
    expect(searchOffset(undefined)).toBe(0);
    expect(searchOffset('25')).toBe(25);
    expect(() => searchOffset('-1')).toThrow(/Invalid cursor/);
    expect(() => searchOffset('https://x')).toThrow(/Invalid cursor/);
  });

  it.skipIf(!IN_PRIVATE_REPO)('every Microsoft list tool with a limit takes a cursor and answers a page', () => {
    const graph = readFileSync('supabase/functions/mcp-msgraph/index.ts', 'utf8');
    expect([...graph.matchAll(/cursor: CURSOR_PROPERTY/g)]).toHaveLength(11);
    expect(graph).not.toMatch(/const clip = /); // the shared one
    expect([...graph.matchAll(/graphCursorPath\(args\.cursor,/g)].length).toBe(10);
    expect(graph).toMatch(/searchOffset\(args\.cursor\)/);
    const outlook = readFileSync('supabase/functions/mcp-outlook/index.ts', 'utf8');
    expect([...outlook.matchAll(/cursor: CURSOR_PROPERTY/g)]).toHaveLength(2);
    expect([...outlook.matchAll(/graphCursorPath\(args\.cursor,/g)]).toHaveLength(2);
  });
});
