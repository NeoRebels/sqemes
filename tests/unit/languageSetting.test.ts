import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { effectiveLocale, shouldSwitchLocale, canChooseLanguage, toLocale, GERMAN_RELEASED } from '../../lib/i18n';

/** SQEM-600 — the language in effect, the release gate, and the reload guard. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-600 — the release gate', () => {
  // SQEM-613 — released. Until then this test held the gate shut on purpose.
  it('German is released', () => {
    expect(GERMAN_RELEASED).toBe(true);
  });
  it('everyone chooses — a person who is not a sqemes admin gets the language they or their workspace set', () => {
    expect(canChooseLanguage(true)).toBe(true);
    expect(canChooseLanguage(false)).toBe(true);
    expect(effectiveLocale('de', 'en', false)).toBe('de');
    expect(effectiveLocale(null, 'de', false)).toBe('de');
  });
  it('nobody is switched without a choice: no profile, no workspace setting → English', () => {
    expect(effectiveLocale(null, null, false)).toBe('en');
    expect(effectiveLocale(null, 'en', false)).toBe('en'); // the column default after the SQEM-600 migration
  });
  it('the preview note disappears with the gate', () => {
    expect(read('components/LanguageCard.tsx')).toMatch(/\{!GERMAN_RELEASED && <p[^>]*>\{m\.settings_language_preview_note\(\)\}<\/p>\}/);
  });
});

describe('SQEM-600 — profile → workspace → English', () => {
  it('the profile wins', () => {
    expect(effectiveLocale('en', 'de', true)).toBe('en');
    expect(effectiveLocale('de', 'en', true)).toBe('de');
  });
  it('no profile choice follows the workspace', () => {
    expect(effectiveLocale(null, 'de', true)).toBe('de');
    expect(effectiveLocale(undefined, 'en', true)).toBe('en');
  });
  it('nothing usable is English', () => {
    expect(effectiveLocale(null, undefined, true)).toBe('en');
    expect(effectiveLocale('fr', 'xx', true)).toBe('en');
  });
  it('a database value is checked, never trusted', () => {
    for (const v of ['DE', 'de-DE', '', 1, {}, null, undefined]) expect(toLocale(v)).toBeNull();
    expect(toLocale('de')).toBe('de');
  });
});

describe('SQEM-600 — the reload guard', () => {
  it('switches when the locale differs and this target was not tried yet', () => {
    expect(shouldSwitchLocale('de', 'en', null)).toBe(true);
    expect(shouldSwitchLocale('de', 'en', 'en')).toBe(true);
  });
  it('does nothing when already right', () => {
    expect(shouldSwitchLocale('de', 'de', null)).toBe(false);
  });
  it('⛔ never tries the same target twice in a session (storage that does not keep the value)', () => {
    expect(shouldSwitchLocale('de', 'en', 'de')).toBe(false);
  });
});

describe('SQEM-600 — the wiring', () => {
  it('AppRoutes applies the language once the person and the workspace are loaded', () => {
    expect(read('App.tsx')).toMatch(/useApplyLocale\(!isLoading && !!workspace\.id && !!currentUser\.id, currentUser\.language, workspace\.language, isSqemesAdmin\)/);
  });
  it('both cards are behind the release gate, the workspace one also behind team:manage', () => {
    const s = read('pages/Settings.tsx');
    expect(s).toMatch(/canChooseLanguage\(isSqemesAdmin\) && can\(currentUser, workspace, 'team:manage'\) && \(\s*<LanguageCard/);
    expect(s).toMatch(/canChooseLanguage\(isSqemesAdmin\) && \(\s*<LanguageCard/);
  });
  // ⚠️ It first landed in the Security tab — the cards above it there look like General's. Pin the tab.
  it('the workspace card sits in the General tab, the profile card in My Profile', () => {
    const s = read('pages/Settings.tsx');
    const at = (needle: string) => s.indexOf(needle);
    const ws = at("title={m.settings_language_workspace_title()}");
    const me = at("title={m.settings_language_profile_title()}");
    expect(ws).toBeGreaterThan(at("activeTab === 'general'"));
    expect(ws).toBeLessThan(at("activeTab === 'security'"));
    expect(me).toBeGreaterThan(at("activeTab === 'profile'"));
  });
  it('the migration guards the workspace column and grants only the language column', () => {
    const s = read('supabase/migrations/20261027080000_sqem600_language.sql');
    expect(s).toMatch(/get_user_role\(old\.id\) is distinct from 'admin'/);
    expect(s).toMatch(/grant update \(language\) on public\.profiles to authenticated/);
    expect(s).toMatch(/check \(language in \('en', 'de'\)\)/);
  });
  it('the store saves both, with null as a real profile value', () => {
    const s = read('store/workspace.tsx');
    expect(s).toMatch(/if \(updates\.language !== undefined\) dbUpdates\.language = updates\.language;[\s\S]*if \(updates\.language !== undefined\) dbUpdates\.language = updates\.language;/);
  });
});

describe('SQEM-600 — the card is a select, like "Default AI model"', () => {
  // ⚠️ The first version used full-width option cards: wide because "Who can edit" carries an
  // explanation per option, which a language does not — and one more bar per language.
  it('a labelled select, capped at max-w-md like its neighbour, no radio cards', () => {
    const card = read('components/LanguageCard.tsx');
    expect(card).toMatch(/<label htmlFor=\{id\}/);
    expect(card).not.toMatch(/role="radio/);
    // SQEM-601 — both are ui/Select now; the shared look lives there, the width stays at the call site.
    const width = (src: string) => src.match(/<Select\s*\n?\s*id=[\s\S]*?className="([^"]+)"/)?.[1];
    expect(card).toMatch(/<Select\s+id=\{id\}/);
    expect(width(card)).toBe('max-w-md');
    expect(width(read('components/AuthoringModelCard.tsx'))).toBe('max-w-md');
  });
});

describe('SQEM-600 — a new language needs no code change in the checks', () => {
  it('browser and server read the supported languages from the compiled list', () => {
    expect(read('lib/i18n.ts')).toMatch(/export function toLocale[\s\S]*?LOCALES as readonly unknown\[\]\)\.includes\(v\)/);
    const server = read('supabase/functions/_shared/locale.ts');
    expect(server).toMatch(/import \{ baseLocale, locales \} from '\.\/i18n\/runtime\.js'/);
    expect(server).not.toMatch(/v === 'de'/);
  });
});
