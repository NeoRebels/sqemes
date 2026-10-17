import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  shouldForward, forwardUrl, withoutRegionParam, forwardToHome,
  FORWARDED_HEADER, HOME_REGION, REGION_PARAM,
} from '../../supabase/functions/_shared/regionForward';

/**
 * SQEM-510 — the MCP functions re-send a call that landed outside the home region to it. SQEM-513 — the
 * home region is the DATABASE's, `eu-west-1`; SQEM-510 had assumed Frankfurt.
 * Claude calls from the US; there every database round trip crossed the Atlantic.
 * These pin the guards: no loop, nothing on self-host, nothing static, and a failed hop is not an outage.
 */
const req = (method: string, headers: Record<string, string> = {}) => ({ method, headers: new Headers(headers) });

beforeAll(() => {
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'SB_REGION' ? 'us-east-1' : undefined) } };
});

describe('shouldForward', () => {
  it('forwards a database call that landed in another region', () => {
    expect(shouldForward(req('POST'), 'us-east-1', true)).toBe(true);
  });
  it('⛔ never on self-host or locally — no SB_REGION, a single server', () => {
    expect(shouldForward(req('POST'), undefined, true)).toBe(false);
    expect(shouldForward(req('POST'), '', true)).toBe(false);
  });
  it('never when already in the home region', () => {
    expect(shouldForward(req('POST'), HOME_REGION, true)).toBe(false);
  });
  it('SQEM-513 — never from another European region: the hop (~300 ms) costs more than the trips to Ireland', () => {
    for (const r of ['eu-central-1', 'eu-central-2', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'eu-south-1']) {
      expect(shouldForward(req('POST'), r, true), r).toBe(false);
    }
  });
  it('SQEM-513 — still forwards from outside Europe (the US, Asia)', () => {
    for (const r of ['us-east-1', 'us-west-1', 'ap-southeast-1', 'sa-east-1', 'ca-central-1']) {
      expect(shouldForward(req('POST'), r, true), r).toBe(true);
    }
  });
  it('⛔ never twice — the loop guard', () => {
    expect(shouldForward(req('POST', { [FORWARDED_HEADER]: 'us-east-1' }), 'us-east-1', true)).toBe(false);
  });
  it('never for CORS preflights or calls without database work', () => {
    expect(shouldForward(req('OPTIONS'), 'us-east-1', true)).toBe(false);
    expect(shouldForward(req('POST'), 'us-east-1', false)).toBe(false);
  });
});

describe('forwardUrl / withoutRegionParam', () => {
  it('addresses our public URL, keeps path and query, forces the home region', () => {
    const u = new URL(forwardUrl('https://api.sqemes.com/', 'http://localhost/mcp-oauth/token?x=1'));
    expect(u.origin + u.pathname).toBe('https://api.sqemes.com/functions/v1/mcp-oauth/token');
    expect(u.searchParams.get('x')).toBe('1');
    expect(u.searchParams.get(REGION_PARAM)).toBe(HOME_REGION);
  });
  it('does not double the /functions/v1 prefix', () => {
    expect(forwardUrl('https://api.sqemes.com', 'http://x/functions/v1/mcp-server')).toBe(`https://api.sqemes.com/functions/v1/mcp-server?${REGION_PARAM}=${HOME_REGION}`);
  });
  it('a handler never sees the routing parameter (mcp-oauth copies every query param onto /authorize)', () => {
    const u = withoutRegionParam(new URL(`https://x/mcp-oauth/authorize?client_id=c&${REGION_PARAM}=${HOME_REGION}`));
    expect([...u.searchParams.keys()]).toEqual(['client_id']);
  });
});

describe('forwardToHome', () => {
  it('re-sends method, body and Authorization unchanged, marks the hop, passes the answer back as is', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{"ok":true}', { status: 201, headers: { 'server-timing': 'total;dur=300', 'x-test': 'y' } });
    }) as unknown as typeof fetch;
    const r = new Request('http://localhost/mcp-server', { method: 'POST', headers: { Authorization: 'Bearer sqm_live_x' }, body: '{"a":1}' });
    const out = await forwardToHome(r, await r.clone().arrayBuffer(), 'https://api.sqemes.com', fake);
    expect(out!.status).toBe(201);
    expect(await out!.text()).toBe('{"ok":true}');
    expect(out!.headers.get('x-test')).toBe('y');
    expect(out!.headers.get('server-timing')).toMatch(/^total;dur=300, forward;dur=\d+$/);
    const h = new Headers(seen!.init.headers);
    expect(h.get('authorization')).toBe('Bearer sqm_live_x');
    expect(h.get(FORWARDED_HEADER)).toBe('us-east-1');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.redirect).toBe('manual'); // OAuth redirects reach the client untouched
  });
  it('⛔ drops content-encoding/length — fetch already decoded the body', async () => {
    const fake = (async () => new Response('plain', { headers: { 'content-encoding': 'gzip', 'content-length': '99' } })) as unknown as typeof fetch;
    const r = new Request('http://localhost/mcp-server', { method: 'POST', body: 'x' });
    const out = await forwardToHome(r, await r.clone().arrayBuffer(), 'https://api.sqemes.com', fake);
    expect(out!.headers.get('content-encoding')).toBeNull();
    expect(out!.headers.get('content-length')).toBeNull();
    expect(await out!.text()).toBe('plain');
  });
  it('⛔ a failed hop returns null, so the caller serves the request itself — slow, not broken', async () => {
    const failing = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = new Request('http://localhost/mcp-server', { method: 'POST', body: 'x' });
    expect(await forwardToHome(r, await r.clone().arrayBuffer(), 'https://api.sqemes.com', failing)).toBeNull();
  });
});

describe('wiring', () => {
  for (const f of ['supabase/functions/mcp-server/index.ts', 'supabase/functions/mcp-oauth/index.ts']) {
    it(`${f} forwards before doing any work and falls back to serving locally`, () => {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/if \(shouldForward\(req, region, /);
      expect(src).toMatch(/if \(forwarded\) return forwarded;/);
      expect(src).toMatch(/SERVED_REGION_HEADER/);
    });
  }
  it('mcp-oauth strips the routing parameter before any handler reads the query', () => {
    expect(readFileSync('supabase/functions/mcp-oauth/index.ts', 'utf8')).toMatch(/const url {2}= withoutRegionParam\(new URL\(req\.url\)\);/);
  });
});
