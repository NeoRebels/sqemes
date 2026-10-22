import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canSeeDesignSystem } from '../../lib/designAccess';

/**
 * SQEM-545 (b) — the design-system page: who sees it, and that it renders the real components.
 * The page itself imports the store (lib/supabase), so its wiring is pinned on the source.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

describe('SQEM-545 — who may open /design', () => {
  const base = { isSqemesAdmin: false, isSelfHosted: false, canManageTeam: false, isDev: false };
  it('Cloud: only a Sqemes admin — not a workspace admin', () => {
    expect(canSeeDesignSystem({ ...base, isSqemesAdmin: true })).toBe(true);
    expect(canSeeDesignSystem({ ...base, canManageTeam: true })).toBe(false);
  });
  it('Self-host: the instance admins', () => {
    expect(canSeeDesignSystem({ ...base, isSelfHosted: true, canManageTeam: true })).toBe(true);
    expect(canSeeDesignSystem({ ...base, isSelfHosted: true })).toBe(false);
  });
  it('a dev build: everybody', () => {
    expect(canSeeDesignSystem({ ...base, isDev: true })).toBe(true);
  });
});

describe('SQEM-545 — the page renders the system instead of describing it', () => {
  const page = read('pages/DesignSystem.tsx');
  it('is routed lazily and guards itself', () => {
    expect(read('App.tsx')).toMatch(/<Route path="\/design" element=\{<LayoutPage><DesignSystem \/><\/LayoutPage>\} \/>/);
    expect(page).toMatch(/if \(!allowed\) return <Navigate to="\/" replace \/>;/);
  });
  it('uses the real primitives and computes contrast from what is painted', () => {
    for (const c of ['<Button', '<Input', '<Checkbox', '<Switch', '<SegmentedTabs', '<KindBadge', '<AccessBadge', '<EmptyState', '<ConfirmModal', '<CardSaveBar', '<MoveButtons']) {
      expect(page, c).toContain(c);
    }
    expect(page).toMatch(/getComputedStyle\(el\)\.color/);
  });
  // SQEM-554 — keep the page, but the app does not link to it. It is reached by
  // its URL only; the route and its access rule stay.
  it('⛔ nothing in the app links to /design; the route itself stays', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/<Route path="\/design" element=\{<LayoutPage><DesignSystem \/><\/LayoutPage>\} \/>/);
    const sources = ['pages/Settings.tsx', 'components/Sidebar.tsx', 'pages/Overview.tsx', 'pages/Dashboard.tsx', 'App.tsx'];
    for (const f of sources) {
      const src = read(f);
      expect(src, f).not.toMatch(/to="\/design"|navigate\('\/design'\)|href="#?\/design"/);
    }
    expect(read('pages/Settings.tsx')).not.toMatch(/canSeeDesignSystem/);
  });
});
