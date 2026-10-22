import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { needsAttention } from '../../lib/needsAttention';
import { MODE_HOME, modeForPath, navRoutes } from '../../lib/navMode';

/**
 * SQEM-552 — the Manage Overview (redesign 4/4). The page imports the store, so it is checked at
 * source level; the attention rules and the navigation are tested directly.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('SQEM-552 — Needs attention', () => {
  const base = { personas: [{ routes: [1] }], playbooks: [{ description: 'x' }], hasUsableModel: true, canManageKeys: true };

  it('nothing to report → empty (the page says "All set")', () => {
    expect(needsAttention(base)).toEqual([]);
  });

  it('counts personas without playbooks and playbooks without a description', () => {
    const r = needsAttention({ ...base, personas: [{ routes: [] }, {}, { routes: [1] }], playbooks: [{ description: '' }, { description: '  ' }, { description: 'ok' }] });
    expect(r.map(i => [i.kind, i.count])).toEqual([['persona-without-playbooks', 2], ['playbook-without-description', 2]]);
    expect(r[0].title).toBe('2 personas load no playbooks');
  });

  it('no model → an item only for someone who can add a key (SQEM-536)', () => {
    expect(needsAttention({ ...base, hasUsableModel: false }).map(i => i.kind)).toEqual(['chat-without-model']);
    expect(needsAttention({ ...base, hasUsableModel: false, canManageKeys: false })).toEqual([]);
  });

  it('⛔ at most three kinds, one item each', () => {
    const r = needsAttention({ personas: [{}, {}], playbooks: [{}, {}], hasUsableModel: false, canManageKeys: true });
    expect(r).toHaveLength(3);
    expect(new Set(r.map(i => i.kind)).size).toBe(3);
  });
});

describe('SQEM-552 — the Overview is the home of Manage', () => {
  it('route, mode and first Manage link', () => {
    expect(modeForPath('/overview')).toBe('manage');
    expect(MODE_HOME.manage).toBe('/overview');
    expect(navRoutes('manage', 'admin', { marketplace: true })[0]).toBe('/overview');
    expect(navRoutes('work', 'member', { marketplace: true })).not.toContain('/overview');
    expect(read('App.tsx')).toMatch(/<Route path="\/overview" element=\{<LayoutPage><Overview \/><\/LayoutPage>\} \/>/);
  });

  it('members are sent to Start; no usage numbers are invented (SQEM-553)', () => {
    const page = read('pages/Overview.tsx');
    expect(page).toMatch(/if \(!allowed\) return <Navigate to="\/" replace \/>;/);
    // ⛔ …but only once the role is known: the loading placeholder is a 'member'.
    expect(page).toMatch(/const roleKnown = !!currentUser\.id && workspace\.members\.some\(m => m\.id === currentUser\.id\);\s+if \(!roleKnown\) return null;\s+if \(!allowed\)/);
    expect(page).not.toMatch(/usage_daily/);
  });

  it('⛔ the moved plan card adds no off-palette colour (violet became brand)', () => {
    expect(read('pages/Overview.tsx')).not.toMatch(/violet-/);
  });
});

describe('SQEM-555 — banners and usage on the Overview', () => {
  it('the trial and setup banners moved from Start; the wizard still opens on Start the first time', () => {
    const start = read('pages/Dashboard.tsx');
    const page = read('pages/Overview.tsx');
    expect(start).not.toMatch(/Finish setting up your workspace/);
    expect(start).not.toMatch(/trial is active/);
    expect(start).toMatch(/\{showWizard && <SetupWizard onClose=\{handleWizardClose\} \/>\}/);
    expect(page).toMatch(/Finish setting up your workspace/);
    expect(page).toMatch(/trial is active/);
    expect(page).toMatch(/\{showWizard && <SetupWizard onClose=\{handleWizardClose\} \/>\}/);
  });

  it('the plan card shows seats and storage as bars', () => {
    const page = read('pages/Overview.tsx');
    expect(page).toMatch(/<UsageBar label="Seats" used=\{seatsUsed\} limit=\{seatsLimit\} tone="onBrand" \/>/);
    expect(page.match(/<UsageBar label="Storage"/g)).toHaveLength(2); // plan and managed card
    expect(page).toMatch(/getWorkspaceStorageUsage\(workspace\.id\)/);
  });
});
