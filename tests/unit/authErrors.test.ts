import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authErrorText, isEmailNotConfirmed } from '../../lib/authErrors';

/** SQEM-603 — sign-in errors in the user's language, never a guess. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const en = JSON.parse(read('messages/en.json')) as Record<string, string>;

describe('SQEM-603 — authErrorText', () => {
  it('a known code gets our text', () => {
    expect(authErrorText({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(en.auth_error_invalid_credentials);
    expect(authErrorText({ code: 'over_email_send_rate_limit', message: 'x' })).toBe(en.auth_error_rate_limit);
    expect(authErrorText({ code: 'email_exists', message: 'x' })).toBe(en.auth_error_user_exists);
  });

  it('⛔ an unknown or missing code keeps the provider message — never a guess', () => {
    expect(authErrorText({ code: 'something_new', message: 'Provider says so' })).toBe('Provider says so');
    expect(authErrorText({ message: 'No code at all' })).toBe('No code at all');
    expect(authErrorText(new Error('Name is required'))).toBe('Name is required');
  });

  it('nothing at all still says something', () => {
    expect(authErrorText(null)).toBe(en.auth_generic_error);
    expect(authErrorText({ code: null, message: '  ' })).toBe(en.auth_generic_error);
  });

  it('every mapped code is a real Supabase code (read from the installed auth-js)', () => {
    const codes = new Set([...read('node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts').matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
    const mapped = [...read('lib/authErrors.ts').matchAll(/^\s+([a-z_]+): m\.auth_error_/gm)].map(x => x[1]);
    expect(mapped.length).toBeGreaterThan(8);
    expect(mapped.filter(c => !codes.has(c))).toEqual([]);
  });
});

describe('SQEM-277 — the resend path survives the change to codes', () => {
  it('recognises email_not_confirmed by code and, without one, by message', () => {
    expect(isEmailNotConfirmed({ code: 'email_not_confirmed', message: '' })).toBe(true);
    expect(isEmailNotConfirmed({ message: 'Email not confirmed' })).toBe(true);
    expect(isEmailNotConfirmed({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
  });

  it('the sign-in page still offers the resend on it', () => {
    expect(read('pages/Auth.tsx')).toMatch(/if \(isEmailNotConfirmed\(error\)\) \{\s*setCanResend\(true\);/);
  });
});

describe('SQEM-603 — <html lang> follows the locale', () => {
  it('the seam sets it at load', () => {
    expect(read('lib/i18n.ts')).toMatch(/document\.documentElement\.lang = getLocale\(\);/);
  });
});
