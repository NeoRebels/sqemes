import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-480 — access and governance settings moved from General into their own Security tab. The move
 * must not change who sees what: every card keeps the condition it had, and the tab is shown only when
 * one of its cards would be.
 */
const src = readFileSync('pages/Settings.tsx', 'utf8');
const block = (start: string, end: string) => {
  const i = src.indexOf(start);
  return src.slice(i, src.indexOf(end, i));
};
const general = block("{activeTab === 'general' && can(currentUser, workspace, 'settings:general') && (", '{/* --- Security Tab --- */}');
const security = block("{activeTab === 'security' && securityTabVisible && (", '{/* --- Brand Tab --- */}');

const CARDS: [string, string][] = [
  ['Playbook Access (workspace default)', "{!IS_SELF_HOSTED && isMultiSeat(workspace) && can(currentUser, workspace, 'team:manage') && ("],
  ['Access groups', "{!IS_SELF_HOSTED && can(currentUser, workspace, 'team:manage') && (\n                <AccessGroupsCard"],
  // Same condition as General's Marketplace Publisher card, so pinned by its heading as well.
  ['self-host access card', '{m.sts_selfhost_title()}</h3>'], // SQEM-608 — the words live in messages/
  ['Content Governance', '{/* SQEM-170 — Content Governance is a Cloud-only feature */}\n              {!IS_SELF_HOSTED && ('],
];

describe('SQEM-480 — the Security tab', () => {
  for (const [name, condition] of CARDS) {
    it(`${name}: in Security with its old condition, and gone from General`, () => {
      expect(security, name).toContain(condition);
      if (name === 'self-host access card') expect(security).toMatch(/\{IS_SELF_HOSTED && can\(currentUser, workspace, 'team:manage'\) && \(\s*<Card className="p-6 md:p-8">\s*<SettingsCardHeader icon=\{<Lock \/>\} title=\{m\.sts_access_title\(\)\}/); // SQEM-554 (d2) — shared head
      expect(general, name).not.toContain(condition);
    });
  }

  it('General keeps the workspace basics', () => {
    for (const keep of ['m.stg_details()', '<AuthoringModelCard', 'm.stg_pub_title()', '<AboutSection />', 'm.stg_danger()']) { // SQEM-608
      expect(general, keep).toContain(keep);
    }
  });

  it('⛔ is shown only when one of its cards is: Cloud admins and editors, self-host admins, never members', () => {
    expect(src).toMatch(/const securityTabVisible = IS_SELF_HOSTED\s*\? can\(currentUser, workspace, 'team:manage'\)\s*: can\(currentUser, workspace, 'settings:general'\);/);
    expect(src).toContain("if (tab.id === 'security' && !securityTabVisible) return false;");
  });

  it('deep links: ?tab=security works, and a link someone could not use lands on General', () => {
    expect(src).toContain("['general', 'brand', 'team', 'security', 'plans', 'api', 'connectors', 'profile'].includes(urlTab)");
    expect(src).toContain("if (requestedTab === 'security' && !securityTabVisible) {");
    expect(src).toContain("(urlTab === 'security' && !securityTabVisible)");
  });

  it('"Create group" in both editors opens Security, where the groups are', () => {
    for (const f of ['pages/TemplateEditor.tsx', 'pages/PersonaEditor.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain("navigate('/settings', { state: { initialTab: 'security' } })");
    }
  });
});
