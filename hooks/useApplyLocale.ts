import { useEffect } from 'react';
import { effectiveLocale, getLocale, setLocale, shouldSwitchLocale, type Locale } from '../lib/i18n';

/** SQEM-600 — remembers which locale this session already reloaded for (see shouldSwitchLocale). */
const ATTEMPT_KEY = 'sqemes_locale_attempt';

/**
 * SQEM-600 — applies the language in effect (profile → workspace → English) once the person and the
 * workspace are loaded, and again whenever either setting or the workspace changes.
 *
 * Switching reloads the page: every text is read at render time, and a reload is the one way to be
 * sure no component keeps an old one. It happens only when the stored locale differs — the first
 * sign-in on a device, or right after a change — because Paraglide keeps the choice in localStorage.
 */
export function useApplyLocale(ready: boolean, profileLanguage: Locale | null | undefined, workspaceLanguage: Locale | undefined, isSqemesAdmin: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const want = effectiveLocale(profileLanguage, workspaceLanguage, isSqemesAdmin);
    let lastAttempt: string | null = null;
    try { lastAttempt = sessionStorage.getItem(ATTEMPT_KEY); } catch { return; } // no storage: never risk a reload loop
    if (!shouldSwitchLocale(want, getLocale(), lastAttempt)) return;
    try { sessionStorage.setItem(ATTEMPT_KEY, want); } catch { return; }
    setLocale(want);
  }, [ready, profileLanguage, workspaceLanguage, isSqemesAdmin]);
}
