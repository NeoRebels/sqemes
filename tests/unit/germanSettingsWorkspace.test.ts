import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-608 — Settings (workspace and profile) in two languages. What the translation must not move:
 * the tab ids (deep links), the role values, and the outcome of a password change.
 */
const ROOT = resolve(__dirname, '../..');
const settings = readFileSync(resolve(ROOT, 'pages/Settings.tsx'), 'utf8');

describe('SQEM-608 — values stay, labels move', () => {
  it('tab ids stay the deep-link keys; only the labels are translated', () => {
    for (const id of ['general', 'brand', 'team', 'security', 'plans', 'api', 'connectors', 'profile']) {
      expect(settings).toMatch(new RegExp(`\\{ id: '${id}', label: m\\.st_tab_${id}\\(\\), icon: `));
    }
    expect(de.st_tab_profile).toBe('Mein Profil');
  });

  it('roles show through roleLabel; the stored value is what the select carries', () => {
    expect(settings).toMatch(/<option key=\{r\} value=\{r\}>\{roleLabel\(r\)\}<\/option>/);
    expect(settings).toMatch(/\{roleLabel\(member\.role\)\}/);
    expect(settings).toMatch(/\{roleLabel\(inv\.role\)\}/);
  });
});

describe('SQEM-608 — a refused password is said, not covered', () => {
  it('the result of the password change is checked before "Profile updated"', () => {
    const save = settings.slice(settings.indexOf('const handleUpdateProfile'), settings.indexOf('const handleLogout'));
    expect(save).toMatch(/const \{ error \} = await supabase\.auth\.updateUser\(\{ password: passwords\.new \}\);\s*if \(error\) \{\s*showToast\(authErrorText\(error\), 'error'\);\s*return;\s*\}/);
    expect(save.indexOf('authErrorText(error), ')).toBeLessThan(save.indexOf('m.stp_saved()'));
    expect(en.stp_saved).toBe('Profile updated successfully');
  });
});
