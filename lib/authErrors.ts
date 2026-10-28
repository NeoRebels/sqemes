import { m } from './i18n';

/**
 * SQEM-603 — the sign-in pages' errors in the user's language.
 *
 * Supabase Auth answers in English (`error.message`), and those messages used to be shown as they
 * came — so a German sign-in page would say "Invalid login credentials". Its errors carry a stable
 * `code` (`@supabase/auth-js` → `lib/error-codes.d.ts`, read at 2.95.3), and the codes these pages
 * can actually meet are mapped here.
 *
 * ⛔ An unknown or missing code falls back to the provider's own message, never to a guess: a wrong
 * explanation is worse than an English one. Codes differ between GoTrue versions, and a self-hoster
 * may run another one.
 *
 * ⚠️ Mind enumeration (SQEM-458). `user_already_exists` / `email_exists` only arrive where Supabase
 * itself has decided to reveal the case (confirmations off); the sign-up form's "check your inbox"
 * message is still what appears when it has not. Nothing here may say more than the code says.
 *
 * Pure (no Supabase import), so it is testable without env vars — see tests-must-not-import-supabase.
 */
export interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
}

const BY_CODE: Record<string, () => string> = {
  invalid_credentials: m.auth_error_invalid_credentials,
  email_not_confirmed: m.auth_error_email_not_confirmed,
  user_already_exists: m.auth_error_user_exists,
  email_exists: m.auth_error_user_exists,
  weak_password: m.auth_error_weak_password,
  same_password: m.auth_error_same_password,
  over_request_rate_limit: m.auth_error_rate_limit,
  over_email_send_rate_limit: m.auth_error_rate_limit,
  captcha_failed: m.auth_error_captcha,
  email_address_invalid: m.auth_error_email_invalid,
  signup_disabled: m.auth_error_signup_disabled,
  otp_expired: m.auth_error_link_expired,
  user_banned: m.auth_error_user_banned,
};

/** The text to show for an auth error: ours for a known code, the provider's otherwise. */
export function authErrorText(error: AuthErrorLike | null | undefined): string {
  const mapped = error?.code ? BY_CODE[error.code] : undefined;
  if (mapped) return mapped();
  return error?.message?.trim() || m.auth_generic_error();
}

/**
 * SQEM-277 — "email not confirmed" is the one sign-in failure with a next step (resend), so the page
 * needs to recognise it. By code first; the message test stays as the fallback for a GoTrue that sends
 * no code, because losing the resend button would strand exactly the account that cannot get the mail.
 */
export function isEmailNotConfirmed(error: AuthErrorLike | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'email_not_confirmed' || /email not confirmed|not confirmed/i.test(error.message ?? '');
}
