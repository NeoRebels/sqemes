import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withLocaleParam, functionsBaseOf } from '../../lib/localeParam';
import { requestLocale, m } from '../../supabase/functions/_shared/locale';
import { budgetMessage } from '../../supabase/functions/_shared/chatBudget';
import { en, de } from './i18nText';

/**
 * SQEM-612 — edge-function refusals in the person's language. The web app adds `?locale=` to every
 * function call; the functions read it through `requestLocale` and answer in it, English otherwise.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const FUNCTIONS = [
  'manage-connectors', 'manage-api-keys', 'delete-workspace-file', 'sign-file-url', 'get-marketplace-bundle',
  'connector-oauth-start', 'analyze-website', 'marketplace-vote', 'marketplace-public', 'create-checkout-session',
  'create-portal-session', 'delete-workspace', 'delete-account', 'execute-step', 'chat-message',
];

describe('SQEM-612 — the client adds the locale as a query parameter', () => {
  const BASES = ['https://api.example.com/functions/v1/', functionsBaseOf('https://mk.example.com/functions/v1/marketplace-public')];

  it('on our functions and the marketplace\'s, keeping parameters already there', () => {
    expect(withLocaleParam('https://api.example.com/functions/v1/chat-message', BASES, 'de'))
      .toBe('https://api.example.com/functions/v1/chat-message?locale=de');
    expect(withLocaleParam('https://api.example.com/functions/v1/chat-message?forceFunctionRegion=eu-west-1', BASES, 'de'))
      .toBe('https://api.example.com/functions/v1/chat-message?forceFunctionRegion=eu-west-1&locale=de');
    expect(withLocaleParam('https://mk.example.com/functions/v1/marketplace-vote', BASES, 'en'))
      .toBe('https://mk.example.com/functions/v1/marketplace-vote?locale=en');
  });

  it('never on anything else, and never twice', () => {
    expect(withLocaleParam('https://api.example.com/rest/v1/prompts?select=*', BASES, 'de')).toBe('https://api.example.com/rest/v1/prompts?select=*');
    expect(withLocaleParam('https://chatgpt.com/functions/v1/x', BASES, 'de')).toBe('https://chatgpt.com/functions/v1/x');
    expect(withLocaleParam('https://api.example.com/functions/v1/x?locale=en', BASES, 'de')).toBe('https://api.example.com/functions/v1/x?locale=en');
    expect(functionsBaseOf('')).toBe('');
  });

  it('⛔ no new header — a CORS preflight the old functions refuse would break every call while the deploys race', () => {
    const src = read('lib/supabase.ts');
    expect(src).toMatch(/withLocaleParam\(url, FUNCTION_BASES, getLocale\(\)\)/);
    expect(src).not.toMatch(/x-sqemes-locale/i);
    expect(read('supabase/functions/_shared/cors.ts')).not.toMatch(/locale/i);
  });
});

describe('SQEM-612 — the server reads it', () => {
  const req = (url: string) => new Request(url, { method: 'POST' });
  it('query first, then the body, then English', () => {
    expect(requestLocale(req('https://x/functions/v1/f?locale=de'))).toBe('de');
    expect(requestLocale(req('https://x/functions/v1/f'), 'de')).toBe('de');
    expect(requestLocale(req('https://x/functions/v1/f?locale=en'), 'de')).toBe('en');
    expect(requestLocale(req('https://x/functions/v1/f'))).toBe('en'); // the extension, MCP, curl
    expect(requestLocale(req('https://x/functions/v1/f?locale=fr'))).toBe('en');
  });

  it('every function in scope reads the locale once at the start of the handler', () => {
    for (const f of FUNCTIONS) {
      const src = read(`supabase/functions/${f}/index.ts`);
      expect(src, f).toMatch(/Deno\.serve\(async \(req\) => \{\n {2}(const|let) locale(: Locale)? = requestLocale\(req\);/);
    }
  });

  it('no translated refusal is left as an English literal in those functions', () => {
    const translated = Object.entries(en).filter(([k]) => k.startsWith('srv_')).map(([, v]) => v)
      .filter((v): v is string => typeof v === 'string' && !v.includes('{'));
    for (const f of FUNCTIONS) {
      const src = read(`supabase/functions/${f}/index.ts`);
      for (const text of translated) expect(src, `${f}: ${text}`).not.toContain(`'${text}'`);
    }
  });

  it('a refusal comes back in German when asked, in English otherwise', () => {
    expect(m.srv_not_member({}, { locale: 'de' })).toBe(de.srv_not_member);
    expect(m.srv_not_member({}, { locale: 'en' })).toBe('Not a member of this workspace');
    expect(budgetMessage({ ok: false, scope: 'person', limit: 30 } as never, 'de')).toMatch(/^Du hast in der letzten Minute mehr als 30 Anfragen/);
    expect(budgetMessage({ ok: false, scope: 'workspace', limit: 30 } as never))
      .toBe('This workspace has sent more than 30 requests in the last minute. It resets within 60 seconds — please try again then.');
  });

  it('the missing-key hint names the real settings tab', () => {
    expect(en.srv_no_key).toBe('No API key configured for {provider}. Add it in Settings → API & MCP.');
    expect(en.srv_no_key).not.toMatch(/LLM API Keys/);
  });

  it('a literal {store} goes in as a value, not as a placeholder', () => {
    expect(read('supabase/functions/manage-connectors/index.ts')).toMatch(/txt\.srv_shop_format\(\{ example: '\{store\}\.myshopify\.com' \}, \{ locale \}\)/);
  });
});
