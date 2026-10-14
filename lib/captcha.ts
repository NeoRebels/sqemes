/**
 * SQEM-501 — the login captcha (Cloudflare Turnstile), chosen on 2026-10-12: the login
 * limit stays at ~30 per minute per IP, and an invisible captcha protects sign-in, sign-up, password
 * reset and the confirmation resend instead of a higher limit.
 *
 * ⛔ **No site key ⇒ no captcha, and nothing changes.** Self-host and local development run without
 * one. The site key alone only makes the app SEND a token; whether Supabase Auth REQUIRES one is a
 * separate project setting, and that must be switched on only after the app sending tokens is
 * deployed — otherwise nobody can sign in.
 *
 * Cloud reads the build-time `VITE_TURNSTILE_SITE_KEY` (a public value — Config, not Sensitive, in
 * Vercel). ⚠️ Self-host is deliberately not wired: a captcha there also needs GoTrue's captcha
 * settings in the Docker stack, and a site key without them would be half a feature.
 */
export const TURNSTILE_SITE_KEY: string =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';

export const captchaEnabled = (siteKey: string = TURNSTILE_SITE_KEY): boolean => siteKey.trim().length > 0;

/** The script the widget loads. One fixed host — the CSP names exactly this origin, no wildcard. */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
