import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { en } from './i18nText';

/**
 * SQEM-554 (d) — Settings in redesign C, tab by tab. Each part removes the old Tailwind colour classes
 * from its tabs and moves card heads onto `SettingsCardHeader`. The OLD pattern below is the one the
 * design baseline counts; a tab listed in DONE must not contain a single match.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const settings = read('pages/Settings.tsx');
const OLD = /\b(?:dark:)?(?:hover:|focus:|disabled:|placeholder:)*(?:bg|text|border|ring|shadow)-(?:slate|brand|white|red|emerald|amber|blue|green|gray)(?:-\d+)?(?:\/\d+)?\b/g;

/**
 * Old classes in a source, minus `text-white`: white text on a filled accent, warning or danger control
 * is intended in both modes, and there is no "on-accent" token to put there instead.
 */
const old = (src: string) => (src.match(OLD) ?? []).filter(c => c !== 'text-white');

/** The JSX of one tab: from its `--- X Tab ---` marker to the next tab's marker. */
function tab(name: string, next: string): string {
  const a = settings.indexOf(`{/* --- ${name} Tab --- */}`);
  const b = settings.indexOf(`{/* --- ${next} Tab --- */}`);
  expect(a, name).toBeGreaterThan(-1);
  expect(b, next).toBeGreaterThan(a);
  return settings.slice(a, b);
}

describe('SQEM-554 (d) — the shared head', () => {
  const src = read('components/ui/SettingsCardHeader.tsx');
  it('display-face title, accent icon, actions beside the text from sm, a danger tone', () => {
    expect(src).toMatch(/<h2 className=\{`font-display text-xl font-semibold flex items-center gap-2 \$\{danger \? 'text-danger' : 'text-ink-strong'\}`\}>/);
    expect(src).toMatch(/flex flex-col sm:flex-row sm:items-start justify-between gap-4/);
    expect(src).toMatch(/export const SETTINGS_FIELD_LABEL = 'block text-xs font-bold text-ink-subtle uppercase tracking-wider mb-2';/);
    expect(src.match(OLD)).toBeNull();
  });
});

describe('SQEM-554 (d1) — page head, tab bar, General, Brand', () => {
  it('the page uses PageHeader, the tab bar the tokens', () => {
    expect(settings).toMatch(/<PageHeader title=\{m\.st_title\(\)\} subtitle=\{m\.st_subtitle\(\)\} \/>/);
    expect([en.st_title, en.st_subtitle]).toEqual(['Workspace Settings', 'Manage your workspace preferences and team']); // SQEM-608
    expect(settings).toMatch(/\? 'bg-accent-soft text-accent shadow-sm'\s*: 'text-ink-muted hover:bg-surface-sunken hover:text-ink-strong'/);
  });
  it('General has no old colour class left, and its heads are the shared one', () => {
    const general = tab('General', 'Security');
    expect(general.match(OLD)).toBeNull();
    expect(general).toMatch(/<SettingsCardHeader title=\{m\.stg_details\(\)\} \/>/);
    expect(general).toMatch(/<SettingsCardHeader tone="danger" title=\{m\.stg_danger\(\)\}/);
    expect(general).not.toMatch(/<h2 className="text-lg font-bold/);
  });
  it('the managed toggle is the shared Switch, named by its visible label', () => {
    expect(tab('General', 'Security')).toMatch(/<Switch\s+checked=\{!!workspace\.isManaged\}[\s\S]{0,240}labelledBy="settings-managed-label"/);
  });
  it('Brand has no old colour class left; the form (shared with the wizard) neither', () => {
    const brand = settings.slice(settings.indexOf("{activeTab === 'brand'"), settings.indexOf('{/* --- Team Tab --- */}'));
    expect(brand.match(OLD)).toBeNull();
    expect(brand).toMatch(/<SettingsCardHeader\s+title=\{m\.stb_title\(\)\}/);
    expect(en.stb_title).toBe('Brand Profile');
    expect(read('components/BrandProfileForm.tsx').match(OLD)).toBeNull();
  });
});

describe('SQEM-554 (d2) — Team and Security', () => {
  it('Security and Team contain no old colour class; their components neither', () => {
    expect(old(tab('Security', 'Brand'))).toEqual([]);
    expect(old(tab('Team', 'Plans'))).toEqual([]);
    expect(old(read('components/AccessGroupsCard.tsx'))).toEqual([]);
    expect(old(read('components/TemplateAccessControl.tsx'))).toEqual([]);
  });
  it('the Content Governance toggles are the shared Switch, with the same draft logic', () => {
    const security = tab('Security', 'Brand');
    expect(security).toMatch(/<Switch\s+checked=\{!!\(governanceDraft\[key\] \?\? workspace\[key\]\)\}/);
    expect(security).toMatch(/if \(value === workspace\[key\]\) delete next\[key\]; else next\[key\] = value;/);
    expect(security).not.toMatch(/role="switch"/); // no hand-built switch left in the tab
  });
  it('no gradient in the self-host upsell (C uses none)', () => {
    expect(tab('Security', 'Brand')).not.toMatch(/bg-gradient-to/);
  });
});

describe('SQEM-554 (d3) — Plans and the API tab', () => {
  it('Plans and the API tab contain no old colour class; AuthoringModelCard neither', () => {
    expect(old(tab('Plans', 'Integrations'))).toEqual([]);
    expect(old(tab('Integrations', 'Profile'))).toEqual([]);
    expect(old(read('components/AuthoringModelCard.tsx'))).toEqual([]);
  });
  it('small status chips: hue from the soft background, dark text (green/amber text on light would miss AA)', () => {
    const api = tab('Integrations', 'Profile');
    expect(api).toMatch(/bg-success-soft text-ink-strong/);
    expect(api).toMatch(/bg-warning-soft text-ink-strong/);
    expect(api).not.toMatch(/text-success"|text-warning"/);
  });
  it('every h2 in Plans and the API tab is in the display face', () => {
    for (const t of [tab('Plans', 'Integrations'), tab('Integrations', 'Profile')]) {
      for (const h of t.match(/<h2 className="[^"]*"/g) ?? []) expect(h).toMatch(/font-display text-xl/);
    }
  });
});

describe('SQEM-554 (d4) — Profile and the dialogs', () => {
  const rest = settings.slice(settings.indexOf('{/* --- Profile Tab --- */}'), settings.indexOf('export default Settings'));
  it('Profile and every dialog below it contain no old colour class; AboutSection neither', () => {
    expect(old(rest)).toEqual([]);
    expect(old(read('components/AboutSection.tsx'))).toEqual([]);
  });
  it('card and dialog titles from 20 px are in the display face', () => {
    for (const h of rest.match(/<h[23] className="[^"]*(?:text-lg|text-xl)[^"]*"/g) ?? []) expect(h).toMatch(/font-display text-xl font-semibold/);
  });
  it('⛔ the whole of Settings is done: not one old colour class in the file', () => {
    expect(old(settings)).toEqual([]);
  });
});

describe('SQEM-554 (d5) — Connectors', () => {
  const cc = read('components/ConnectorsCard.tsx');
  it('ConnectorsCard contains no old colour class and no gradient', () => {
    expect(old(cc)).toEqual([]);
    expect(cc).not.toMatch(/bg-gradient-to/);
  });
  it('titles from 20 px are in the display face', () => {
    for (const h of cc.match(/<h[23] className="[^"]*(?:text-lg|text-xl)[^"]*"/g) ?? []) expect(h).toMatch(/font-display text-xl font-semibold/);
  });
});

describe('SQEM-554 (e1) — Files', () => {
  const files = read('pages/Files.tsx');
  it('contains no old colour class; the dialog title is in the display face', () => {
    expect(old(files)).toEqual([]);
    expect(files).toMatch(/<h3 className="font-display text-xl font-semibold text-ink-strong mb-2">/);
  });
  it('warning text stays readable: the hue on the icon, not on the sentence', () => {
    expect(files).toMatch(/<p className="text-sm text-ink mb-2 flex items-start gap-2">\s*<Lock className="w-4 h-4 shrink-0 mt-0\.5 text-warning" \/>/);
  });
});

describe('SQEM-554 (e2) — Marketplace', () => {
  // The temperature colours stay: sky-blue IS "cold". Everything else is on tokens.
  const noSky = (src: string) => old(src).filter(c => !/sky-/.test(c));
  const lib = read('pages/Library.tsx');
  it('list, detail page and the shared ListingView (also the public page) contain no old colour class', () => {
    expect(noSky(lib)).toEqual([]);
    expect(noSky(read('components/marketplace/ListingView.tsx'))).toEqual([]);
    expect(noSky(read('pages/MarketplaceTemplate.tsx'))).toEqual([]);
  });
  it('categories are neutral badges; CATEGORY_COLORS is gone', () => {
    expect(lib).toMatch(/rounded-lg bg-surface-sunken text-ink-muted">/);
    expect(lib).not.toMatch(/CATEGORY_COLORS/);
    expect(read('constants.ts')).not.toMatch(/export const CATEGORY_COLORS/);
  });
  it('the card ends in a quiet "Details →" link, not a filled button', () => {
    expect(lib).toMatch(/className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"\s*>\s*\{txt\.mk_details\(\)\} <ArrowRight/);
    expect(en.mk_details).toBe('Details'); // SQEM-607
    expect(lib).not.toMatch(/See playbook details<\/|> See playbook details/);
  });
  it('the temperature keeps its meaning: hot is danger, cold stays sky', () => {
    expect(lib).toMatch(/text-danger bg-danger-soft/);
    expect(lib).toMatch(/text-sky-500/);
  });
});

describe('SQEM-554 (f1) — setup wizard, plan page, the blocked-connector line', () => {
  // White on the wizard's accent band (title, progress, step line) is intended, like text-white on a button.
  const onBand = (src: string) => old(src).filter(c => !/^(text|bg)-white(\/\d+)?$/.test(c));
  it('the wizard and the plan page contain no old colour class and no gradient', () => {
    const wizard = read('components/SetupWizard.tsx');
    expect(onBand(wizard)).toEqual([]);
    expect(wizard).not.toMatch(/bg-gradient-to/);
    expect(old(read('components/ChoosePlanScreen.tsx'))).toEqual([]);
  });
  it('the success banner: hue in the background and icon, dark text', () => {
    expect(read('components/SetupWizard.tsx')).toMatch(/rounded-card bg-success-soft border border-success\/30 text-ink-strong p-5/);
  });
  it('a blocked connector reads in dark text with an amber icon, not amber text', () => {
    const cc = read('components/ConnectorsCard.tsx');
    expect(cc).toMatch(/: blocked \? 'text-ink font-semibold'/);
    expect(cc).toMatch(/\{blocked && !connected && <AlertTriangle aria-hidden className="inline w-3 h-3 mr-1 -mt-0\.5 text-warning" \/>\}/);
  });
});

describe('SQEM-554 (f2) — sign-in, reset, invitation, 404, first workspace', () => {
  const files = ['pages/Auth.tsx', 'pages/ResetPassword.tsx', 'pages/InviteAccept.tsx', 'pages/NotFound.tsx'];
  it('none of them contains an old colour class', () => {
    for (const f of files) expect(old(read(f)), f).toEqual([]);
    const app = read('App.tsx');
    expect(old(app.slice(app.indexOf('const NoWorkspaceScreen'), app.indexOf('const AppRoutes')))).toEqual([]);
  });
  it('titles from 20 px are in the display face; the wordmark stays the wordmark', () => {
    for (const f of files) {
      for (const h of read(f).match(/<h[12] className="[^"]*\btext-(?:xl|2xl|3xl)\b[^"]*"/g) ?? []) expect(h, f).toMatch(/font-display/);
    }
    expect(read('App.tsx')).toMatch(/<span className="text-2xl font-bold text-ink-strong">sqemes<\/span>/);
  });
});

