import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deviceKey, signInOutcome, NEW_SIGN_IN_MAX_AGE_MS } from '../../supabase/functions/_shared/userAgent';
import { parseUserAgent } from '../../lib/userAgent';

const chrome142 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const chrome143 = chrome142.replace('Chrome/142.0.0.0', 'Chrome/143.0.0.0');
const firefoxMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const strip = (s: string) => s.replace(/--.*$/gm, '');

describe('deviceKey (SQEM-692)', () => {
  it('is browser family, system and country', () => {
    expect(deviceKey(chrome142, 'de')).toBe('Chrome|macOS|DE');
    expect(deviceKey(null, null)).toBe('unknown|unknown|');
  });
  it('a browser update is the same device; another browser or country is not', () => {
    expect(deviceKey(chrome143, 'DE')).toBe(deviceKey(chrome142, 'DE'));
    expect(deviceKey(firefoxMac, 'DE')).not.toBe(deviceKey(chrome142, 'DE'));
    expect(deviceKey(chrome142, 'US')).not.toBe(deviceKey(chrome142, 'DE'));
  });
  it('the card and the mail use the same parser', () => {
    expect(parseUserAgent(firefoxMac)).toEqual({ browser: 'Firefox', os: 'macOS', kind: 'desktop' });
  });
});

describe('signInOutcome', () => {
  const base = { bootstrap: false, knownDevices: 2, isKnown: false, ageMs: 3 * 60_000 };
  it('mails only a new device of someone with known devices', () => {
    expect(signInOutcome(base)).toBe('new');
    expect(signInOutcome({ ...base, isKnown: true })).toBe('known');
  });
  it('the rollout and a first device ever only record', () => {
    expect(signInOutcome({ ...base, bootstrap: true })).toBe('bootstrap');
    expect(signInOutcome({ ...base, knownDevices: 0 })).toBe('first');
  });
  it('a sign-in found too late gets no mail', () => {
    expect(signInOutcome({ ...base, ageMs: NEW_SIGN_IN_MAX_AGE_MS + 1 })).toBe('late');
  });
});

describe('the SQEM-692 migration', () => {
  const sql = strip(read('supabase/migrations/20261114210000_sqem692_new_device_mail.sql'));
  it('never touches the sign-in itself', () => {
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?trigger/i);
  });
  it('gives no client a table or a function', () => {
    expect(sql).toMatch(/revoke all on table public\.known_devices from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on table public\.sign_in_check_state from public, anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on function public\.claim_new_sign_ins\(\) from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.new_sign_in_tick\(\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute[^;]*to authenticated/);
  });
  it('skips MCP clients, waits two minutes for the place and schedules one job', () => {
    expect(sql).toContain("to_jsonb(s) ->> 'oauth_client_id' is null");
    expect(sql).toContain("now() - interval '2 minutes'");
    expect(sql).toContain("cron.schedule('new-sign-in-tick', '* * * * *'");
  });
});

describe('the SQEM-692 fix (20261114220000)', () => {
  // Called through PostgREST, Supabase refuses an UPDATE without a WHERE (pg-safeupdate, 21000): every run
  // after the first failed until this fix. A rolled-back test over the Management API does not
  // load that module, so it cannot catch this; the source check does.
  const fix = strip(read('supabase/migrations/20261114220000_sqem692_claim_update_where.sql'));
  it('every UPDATE in the claim has a WHERE', () => {
    const updates = fix.match(/\bupdate\s+public\.[^;]+;/gi) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect(u).toMatch(/\bwhere\b/i);
  });
});

describe('notify-new-sign-in', () => {
  const src = read('supabase/functions/notify-new-sign-in/index.ts');
  it('answers only the cron job', () => {
    expect(src).toContain("sameSecret(req.headers.get('x-routine-dispatch') ?? '', secret)");
    expect(read('supabase/config.toml')).toMatch(/\[functions\.notify-new-sign-in\]\nverify_jwt = false/);
  });
  it('logs counts only', () => {
    const logs = src.match(/console\.(log|error)\([^;]*;/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toMatch(/email|\.ip|user_agent/);
  });
  it('links to the Devices card, which the profile scrolls to', () => {
    expect(src).toContain('/#/settings?tab=profile&section=devices');
    expect(read('pages/Settings.tsx')).toContain("get('section') === 'devices'");
  });
});
