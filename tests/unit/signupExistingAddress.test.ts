import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-458 — the sign-up form must not promise a mail it cannot know was sent.
 *
 * `signUp()` with an address that already has an account returns **no error and no session** —
 * the same shape as a fresh sign-up awaiting confirmation. Supabase obfuscates it on purpose, so
 * the form cannot be used to test which addresses are registered.
 *
 * Measured against the staging project on 2026-09-21. The two responses differ in one field:
 *
 * | | existing address | new address |
 * |---|---|---|
 * | HTTP / error | 200 / none | 200 / none |
 * | `access_token` (→ `session`) | absent | absent |
 * | `email_confirmed_at` | null | null |
 * | `confirmation_sent_at` | **set — for a mail never sent** | set |
 * | `identities` | `[]` | `[{ provider: 'email' }]` |
 *
 * ⛔ `id` and `created_at` are fabricated to match too. So the old copy — *"open the confirmation
 * link we just emailed you"* — was false for exactly the person who already had an account, and
 * the resend button offered to send the non-existent mail again.
 *
 * ⚠️ Reading `identities` to tell them apart was considered and rejected (owner, 2026-09-21): not
 * a guaranteed part of the API, fails silently rather than breaking, and re-opens the account
 * enumeration the obfuscation closes. The wording is true under both causes instead — that is what
 * this file guards.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// ⚠️ Line comments BEFORE block comments — same stripper as `assistantsBecomeSkills.test.ts`.
// Needed here for a second reason too: the comment in `Auth.tsx` explaining why `setCanResend(true)`
// is absent contains that very call, so the branch assertion below reads its own explanation as a
// violation unless comments are stripped first.
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const auth = read('pages/Auth.tsx');
const authCode = code(auth);

describe('SQEM-458 — sign-up says only what it can know', () => {
  it('⛔ does not claim a mail was sent', () => {
    expect(authCode).not.toMatch(/we just emailed you/i);
    expect(authCode).not.toMatch(/Almost there/i);
  });

  it('⛔ the message holds under both causes and names a next step for each', () => {
    const msg = authCode.match(/setMessage\('Check your inbox[^']*'\)/)?.[0] ?? '';
    expect(msg, 'the sign-up message is gone or was reworded').not.toBe('');
    // "if this address is new" — the confirmation case; "already have an account" — the other one.
    expect(msg).toMatch(/if this address is new/i);
    expect(msg).toMatch(/already have an account/i);
    expect(msg).toMatch(/sign in/i);
  });

  it('⛔ `identities` is never read — that path is the enumeration leak, not the fix', () => {
    expect(authCode).not.toMatch(/\bidentities\b\s*[.[?]/);
    expect(code(read('hooks/useAuth.ts'))).not.toMatch(/\bidentities\b/);
  });

  it('⚠️ the resend offer stays in the sign-in branch, where a confirmation is known to be due', () => {
    // SQEM-277 put it there ("never on spec"). The sign-up branch offering it was the regression:
    // it fired on a response that cannot distinguish the two cases.
    const signIn = authCode.slice(0, authCode.indexOf('} else if (mode ==='));
    expect(signIn).toMatch(/setCanResend\(true\)/);
    const signUp = authCode.slice(authCode.indexOf('const { data, error } = await signUp('));
    expect(signUp.slice(0, signUp.indexOf('} catch'))).not.toMatch(/setCanResend\(true\)/);
  });
});
