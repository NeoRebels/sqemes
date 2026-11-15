import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseUserAgent, formatPlace, sessionIdFromAccessToken } from '../../lib/userAgent';
import { placeFromHeaders } from '../../api/session-geo';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  samsungTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
};

describe('parseUserAgent (SQEM-691)', () => {
  it.each([
    ['chromeMac', 'Chrome', 'macOS', 'desktop'],
    ['safariMac', 'Safari', 'macOS', 'desktop'],
    ['edgeWin', 'Edge', 'Windows', 'desktop'],
    ['firefoxLinux', 'Firefox', 'Linux', 'desktop'],
    ['safariIphone', 'Safari', 'iOS', 'mobile'],
    ['chromeIos', 'Chrome', 'iOS', 'mobile'],
    ['chromeAndroid', 'Chrome', 'Android', 'mobile'],
    ['samsungTablet', 'Samsung Internet', 'Android', 'tablet'],
    ['ipad', 'Safari', 'iPadOS', 'tablet'],
    ['opera', 'Opera', 'Windows', 'desktop'],
  ] as const)('%s', (key, browser, os, kind) => {
    expect(parseUserAgent(UA[key])).toEqual({ browser, os, kind });
  });

  it('knows nothing about an unknown or missing agent', () => {
    expect(parseUserAgent('curl/8.7.1')).toEqual({ browser: null, os: null, kind: 'desktop' });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, kind: 'desktop' });
  });
});

describe('formatPlace', () => {
  it('joins what is known', () => {
    expect(formatPlace('Berlin', 'DE')).toBe('Berlin, DE');
    expect(formatPlace(null, 'DE')).toBe('DE');
    expect(formatPlace(' ', null)).toBeNull();
  });
});

describe('sessionIdFromAccessToken', () => {
  const token = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;
  it('reads the claim', () => {
    expect(sessionIdFromAccessToken(token({ session_id: 'abc' }))).toBe('abc');
  });
  it('is null for anything else', () => {
    expect(sessionIdFromAccessToken(token({ sub: 'x' }))).toBeNull();
    expect(sessionIdFromAccessToken('not-a-jwt')).toBeNull();
    expect(sessionIdFromAccessToken(undefined)).toBeNull();
  });
});

describe('placeFromHeaders (api/session-geo)', () => {
  it('decodes the city and checks the country', () => {
    expect(placeFromHeaders({ 'x-vercel-ip-city': 'Bad%20Homburg', 'x-vercel-ip-country': 'de' }))
      .toEqual({ city: 'Bad Homburg', country: 'DE' });
    expect(placeFromHeaders({ 'x-vercel-ip-city': 'M%C3%BCnchen' }).city).toBe('München');
  });
  it('returns nulls without the headers (self-host, local)', () => {
    expect(placeFromHeaders({})).toEqual({ city: null, country: null });
    expect(placeFromHeaders({ 'x-vercel-ip-country': 'XXX' }).country).toBeNull();
  });
});

describe('the SQEM-691 migration keeps every function on the caller', () => {
  // Measured in a rolled-back transaction against a real database (foreign session invisible and
  // not revocable, own current session refused, table not readable directly). This guards the source.
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261114150000_sqem691_my_sessions.sql'), 'utf8')
    .replace(/--.*$/gm, '');
  it('filters on auth.uid() in every definer function', () => {
    for (const fn of ['list_my_sessions', 'revoke_my_session', 'set_my_session_location']) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`)).split('$$;')[0];
      expect(body, fn).toMatch(/security definer/);
      expect(body, fn).toMatch(/auth\.uid\(\)/);
    }
  });
  it('gives anon nothing and the table to nobody', () => {
    expect(sql).toMatch(/revoke all on table public\.session_locations from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql.match(/revoke all on function public\.\w+\([^)]*\) from public, anon, authenticated;/g)).toHaveLength(4);
  });
});
