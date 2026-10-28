import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { en } from './i18nText';

/**
 * SQEM-534 — the workspace default for "Who can edit". The database applies it on every insert and lets
 * only an admin change it (tests/isolation/editDefault.test.ts); this pins the card, the save path and
 * that both editors SHOW a new object the way the database will store it.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const settings = read('pages/Settings.tsx');
const security = settings.slice(settings.indexOf('{/* --- Security Tab --- */}'), settings.indexOf('{/* --- Brand Tab --- */}'));

describe('SQEM-534 — the setting', () => {
  it('sits in Security with the conditions of Playbook Access (admin, Cloud, several seats)', () => {
    // SQEM-554 (d2) — the heads are `SettingsCardHeader` now; the order and the condition are what count.
    const i = security.indexOf('title={m.sts_edit_title()}');
    expect(i).toBeGreaterThan(security.indexOf('title={m.sts_access_title()}'));
    expect([en.sts_edit_title, en.sts_access_title]).toEqual(['Who can edit new playbooks and personas', 'Playbook Access']); // SQEM-608
    expect(security.slice(0, i + 60)).toMatch(/\{!IS_SELF_HOSTED && isMultiSeat\(workspace\) && can\(currentUser, workspace, 'team:manage'\) && \(\s*<Card className="p-6 md:p-8">\s*<SettingsCardHeader title=\{m\.sts_edit_title\(\)\}/);
    // SQEM-539 — written by the card's Save button from a draft, no longer on the click itself.
    expect(security).toContain("saveCard('edit', { defaultEditRestricted: editDraft }");
  });
  it('is read and written under its column name', () => {
    expect(read('lib/api/workspaces.ts')).toContain('defaultEditRestricted: (row as unknown as { default_edit_restricted?: boolean }).default_edit_restricted ?? false');
    expect(read('store/workspace.tsx')).toContain('dbUpdates.default_edit_restricted = updates.defaultEditRestricted');
  });
});

describe('SQEM-534 — both editors start a NEW object as the default says', () => {
  for (const f of ['pages/TemplateEditor.tsx', 'pages/PersonaEditor.tsx']) {
    it(f, () => {
      expect(read(f)).toContain("mode: !id && workspace?.defaultEditRestricted ? 'restricted' : 'everyone', userIds: [], groupIds: [],");
    });
  }
});

describe('SQEM-534 — the migration', () => {
  const mig = read('supabase/migrations/20261020140000_sqem534_edit_default.sql');
  it('applies it by trigger on both tables, for every writer', () => {
    expect(mig).toContain('create trigger apply_default_edit_restriction after insert on public.prompts');
    expect(mig).toContain('create trigger apply_default_edit_restriction after insert on public.personas');
  });
  it('⛔ only an admin changes the setting; a client insert starts false', () => {
    expect(mig).toMatch(/public\.get_user_role\(old\.id\) is distinct from 'admin' then\s+new\.default_edit_restricted := old\.default_edit_restricted;/);
    expect(mig).toMatch(/if tg_op = 'INSERT' then\s+new\.default_edit_restricted := false;/);
  });
  it('⛔ the definer trigger function is not callable by clients', () => {
    expect(mig).toContain('revoke all on function public.apply_default_edit_restriction() from public, anon, authenticated;');
  });
});
