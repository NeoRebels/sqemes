/**
 * SQEM-599 — the browser's ONE seam to the UI texts (epic SQEM-407, German UI).
 *
 * ⛔ Nothing else in the frontend imports the generated Paraglide output or `@inlang/paraglide-js`;
 * a test holds that line (tests/unit/i18nSeam.test.ts). The reason is the exit: if Paraglide ever has
 * to go, only this file and the server's twin (supabase/functions/_shared/locale.ts) change, and the
 * ~2,000 `m.key()` calls stay as they are.
 *
 * Texts live in messages/en.json and messages/de.json; `npm run i18n` (or the Vite plugin) compiles
 * them into supabase/functions/_shared/i18n/, which is committed — see `pm/DOCUMENTATION.md` in the source repository → Languages.
 *
 * ⚠️ German is not offered yet: it ships only when every text is translated.
 * Until then the locale is English unless a developer sets `localStorage.sqemes_locale = 'de'`.
 */
export { m } from '../supabase/functions/_shared/i18n/messages.js';
import {
  baseLocale, getLocale as paraglideGetLocale, locales, setLocale as paraglideSetLocale,
} from '../supabase/functions/_shared/i18n/runtime.js';

export type Locale = typeof locales[number];
export const LOCALES: readonly Locale[] = locales;
export const BASE_LOCALE: Locale = baseLocale;

/** The locale in effect. Falls back to English on anything unexpected rather than throwing in render. */
export function getLocale(): Locale {
  try {
    return paraglideGetLocale();
  } catch {
    return BASE_LOCALE;
  }
}

/**
 * SQEM-603 — `<html lang>` follows the locale. Without it a screen reader reads German text with
 * English pronunciation and the browser offers to "translate" a page that is already German.
 * Set once at load: every switch reloads the page (`setLocale`), so this runs again after it.
 */
if (typeof document !== 'undefined') document.documentElement.lang = getLocale();

/** Switches the locale. Reloads the page, so every text renders in the new language. */
export function setLocale(locale: Locale): void {
  paraglideSetLocale(locale);
}

/**
 * SQEM-600 — the release gate. While `false`, the language settings were shown to, and German applied
 * for, sqemes admins only, so nobody else saw a half-translated app. SQEM-613
 * released German: everyone chooses. Kept as a constant, not deleted — a third language is the moment
 * to turn it into a list of released locales (`pm/DOCUMENTATION.md` in the source repository → Languages).
 */
export const GERMAN_RELEASED = true;

/** Whether this person sees the language settings at all. */
export function canChooseLanguage(isSqemesAdmin: boolean): boolean {
  return GERMAN_RELEASED || isSqemesAdmin;
}

/**
 * Anything but a supported locale is null — a value from the database is checked, never trusted.
 * Read from the compiled list (project.inlang), so a new language needs no change here.
 */
export function toLocale(v: unknown): Locale | null {
  return (LOCALES as readonly unknown[]).includes(v) ? v as Locale : null;
}

/**
 * The language in effect: the person's own choice, else the workspace default, else English.
 * Pure, so the whole rule is unit-testable (tests/unit/languageSetting.test.ts).
 */
export function effectiveLocale(profileLanguage: unknown, workspaceLanguage: unknown, isSqemesAdmin: boolean): Locale {
  if (!canChooseLanguage(isSqemesAdmin)) return BASE_LOCALE;
  return toLocale(profileLanguage) ?? toLocale(workspaceLanguage) ?? BASE_LOCALE;
}

/**
 * Whether to switch (which reloads the page) — at most ONCE per target per session.
 *
 * ⛔ Without the guard, storage that does not keep the value (a private window, blocked site data)
 * means the locale after the reload is the old one again, and the page reloads forever. With it, the
 * second attempt for the same target is skipped and the app stays usable, in the old language.
 */
export function shouldSwitchLocale(want: Locale, current: Locale, lastAttempt: string | null): boolean {
  return want !== current && lastAttempt !== want;
}
