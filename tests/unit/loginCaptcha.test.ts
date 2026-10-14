import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captchaEnabled, TURNSTILE_SCRIPT } from '../../lib/captcha';

/**
 * SQEM-501 — the login captcha (Cloudflare Turnstile). Read as source where the point is the shape of
 * the wiring: every Supabase entry point the captcha protects must carry the token, or enabling
 * enforcement locks people out of exactly that path.
 */
const AUTH = readFileSync('hooks/useAuth.ts', 'utf8');
const PAGE = readFileSync('pages/Auth.tsx', 'utf8');
const CSP = readFileSync('vercel.json', 'utf8');

describe('captchaEnabled', () => {
  it('⛔ no site key ⇒ off (self-host, local, a Cloud build without the variable)', () => {
    expect(captchaEnabled('')).toBe(false);
    expect(captchaEnabled('   ')).toBe(false);
  });
  it('a site key ⇒ on', () => {
    expect(captchaEnabled('0x4AAAAAAAexample')).toBe(true);
  });
  it('loads from exactly one host, explicitly rendered', () => {
    expect(new URL(TURNSTILE_SCRIPT).origin).toBe('https://challenges.cloudflare.com');
    expect(TURNSTILE_SCRIPT).toMatch(/render=explicit/);
  });
});

describe('every protected auth call can carry the token', () => {
  for (const call of ['signUp', 'resendConfirmation', 'signIn', 'resetPassword']) {
    it(`${call} takes an optional captchaToken`, () => {
      expect(AUTH).toMatch(new RegExp(`const ${call} = useCallback\\(async \\([^)]*captchaToken\\?: string\\)`));
    });
  }
  it('the token reaches Supabase on all four (and only when present)', () => {
    expect(AUTH.match(/captchaToken \? \{ captchaToken \} : \{\}/g)?.length).toBe(3); // signUp, resend, reset
    expect(AUTH).toMatch(/captchaToken \? \{ options: \{ captchaToken \} \} : \{\}/); // signInWithPassword
  });
  it('the page passes it to all four', () => {
    expect(PAGE).toMatch(/signIn\(email, password, token\)/);
    expect(PAGE).toMatch(/resetPassword\(email, token\)/);
    expect(PAGE).toMatch(/signUp\(email, password, name, token\)/);
    expect(PAGE).toMatch(/resendConfirmation\(email, token\)/);
  });
  it('the widget renders only when the captcha is on, and a token is renewed after every attempt', () => {
    expect(PAGE).toMatch(/\{captchaOn && \(\s*<TurnstileWidget/);
    expect(PAGE.match(/if \(captchaOn\) setCaptchaReset\(n => n \+ 1\)/g)?.length).toBe(2);
  });
});

describe('CSP', () => {
  it('Turnstile may load its script and its iframe — that one host, no wildcard', () => {
    expect(CSP.match(/script-src[^;"]*/)![0]).toBe("script-src 'self' https://challenges.cloudflare.com");
    expect(CSP).toMatch(/frame-src[^;"]*https:\/\/challenges\.cloudflare\.com/);
    expect(CSP).not.toMatch(/\*\.cloudflare\.com/);
  });
});
