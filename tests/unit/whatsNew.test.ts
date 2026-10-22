import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-485 — "What's new" in the sidebar. Cloud: the changelog inside the Gleap window, with the link's
 * own href as the fallback so the click is never dead. Self-host: the release notes on GitHub.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const sidebar = read('components/Sidebar.tsx');
const gleap = read('lib/gleap.ts');
const links = read('lib/links.ts');

describe('SQEM-485 — What\'s new', () => {
  it('self-host links to the GitHub releases; Cloud falls back to a link when Gleap cannot open', () => {
    expect(links).toContain("export const WHATS_NEW_FALLBACK_URL = 'https://roadmap.sqemes.com/en/changelogs';");
    expect(sidebar).toContain('href={IS_SELF_HOSTED ? SELF_HOST_RELEASES_URL : WHATS_NEW_FALLBACK_URL}');
    expect(links).toContain("export const SELF_HOST_RELEASES_URL = 'https://github.com/NeoRebels/sqemes/releases';");
  });
  it('⛔ the default navigation is only prevented when Gleap actually opened', () => {
    expect(sidebar).toContain('onClick={(e) => { if (!IS_SELF_HOSTED && openWhatsNew()) e.preventDefault(); }}');
  });
  it('shows the new-tab arrow exactly when the click opens a new tab (self-host, or no Gleap key in this build)', () => {
    expect(sidebar).toContain('{(IS_SELF_HOSTED || !gleapConfigured) && <ArrowUpRight');
  });
  it('openWhatsNew reports false while Gleap is not running, and uses the SDK it started', () => {
    expect(gleap).toMatch(/export function openWhatsNew\(\): boolean \{\s*if \(!gleapSdk\) return false;/);
    expect(gleap).toMatch(/Gleap\.initialize\(KEY\);\s*gleapSdk = Gleap;/);
  });
  it('⛔ still never loads Gleap on its own — only startGleap does, inside the signed-in tree', () => {
    const fn = gleap.slice(gleap.indexOf('export function openWhatsNew'), gleap.indexOf('export async function startGleap'));
    expect(fn).not.toContain("import('gleap')");
  });
});
