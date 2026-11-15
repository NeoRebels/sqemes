// SQEM-691 — "Chrome on macOS" from a user agent: the Devices card (lib/userAgent.ts re-exports it) and,
// since SQEM-692, the new-device mail, which must recognise a device exactly the way the card names it.
// Deliberately small and without a dependency: a browser family and a system, not a version or a device
// model. Order matters: Edge, Opera and Samsung Internet all claim "Chrome", and every Chromium browser
// claims "Safari", so the specific names are tested before the general ones.
// ⚠️ Free of imports, so the browser bundle and tests/unit reach it.

export type DeviceKind = 'desktop' | 'mobile' | 'tablet';

export interface ParsedUserAgent {
  browser: string | null;
  os: string | null;
  kind: DeviceKind;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\b(?:iPhone|iPod)\b/, 'iOS'],
  [/\biPad\b/, 'iPadOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = ua ?? '';
  const browser = BROWSERS.find(([re]) => re.test(s))?.[1] ?? null;
  const os = SYSTEMS.find(([re]) => re.test(s))?.[1] ?? null;
  const kind: DeviceKind = /\biPad\b|\bTablet\b/.test(s) || (/\bAndroid\b/.test(s) && !/\bMobile\b/.test(s))
    ? 'tablet'
    : /\bMobile\b|\biPhone\b/.test(s) ? 'mobile' : 'desktop';
  return { browser, os, kind };
}

/**
 * SQEM-692 — what makes a device "known": browser family, system and country. No browser version (every
 * update would be a new device), no IP (mobile networks change it all the time). The country comes from
 * the app's own location row (SQEM-691) and is missing on self-host and when it could not be read; it is
 * then empty, consistently, so a device is still recognised by family and system.
 */
export function deviceKey(ua: string | null | undefined, country: string | null | undefined): string {
  const { browser, os } = parseUserAgent(ua);
  return [browser ?? 'unknown', os ?? 'unknown', (country ?? '').trim().toUpperCase()].join('|');
}

export type SignInOutcome = 'bootstrap' | 'first' | 'late' | 'known' | 'new';

/** A sign-in older than this when it is checked gets no mail: a mail hours later warns nobody (cron down). */
export const NEW_SIGN_IN_MAX_AGE_MS = 60 * 60_000;

/**
 * SQEM-692 — what the check does with one new session. Only `new` sends a mail.
 * - `bootstrap`: the very first run after the rollout, which records every open session (no mail flood).
 * - `first`: the person has no known device yet (the sign-in right after registration, or the first one
 *   after the rollout for someone who was signed out at that moment).
 */
export function signInOutcome(o: { bootstrap: boolean; knownDevices: number; isKnown: boolean; ageMs: number }): SignInOutcome {
  if (o.bootstrap) return 'bootstrap';
  if (o.knownDevices === 0) return 'first';
  if (o.isKnown) return 'known';
  if (o.ageMs > NEW_SIGN_IN_MAX_AGE_MS) return 'late';
  return 'new';
}
