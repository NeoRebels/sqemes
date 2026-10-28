import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-607 — Files, Marketplace and the Overview in two languages. What a translation must not
 * change is pinned here: values that leave the page stay English, only their labels move.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-607 — values stay, labels move', () => {
  it('a report reason goes to the moderation queue in English; the option shows the label', () => {
    const src = read('pages/MarketplaceTemplate.tsx');
    expect(src).toMatch(/\['Spam or low quality', txt\.mk_reason_spam\]/);
    expect(src).toMatch(/<option key=\{value\} value=\{value\}>\{label\(\)\}<\/option>/);
    expect(src).toMatch(/useState\(REPORT_REASONS\[0\]\[0\]\)/);
    expect(de.mk_reason_spam).toBe('Spam oder geringe Qualität');
  });

  it('marketplace categories filter by the stored value and show the label', () => {
    const lib = read('pages/Library.tsx');
    expect(lib).toMatch(/if \(activeCategory !== 'All' && t\.category !== activeCategory\) return false;/);
    expect(lib).toMatch(/\{cat === 'All' \? txt\.pb_tab_all\(\) : categoryLabel\(cat\)\}/);
    expect(lib).toMatch(/\{categoryLabel\(template\.category\)\}/);
    expect(read('components/marketplace/ListingView.tsx')).toMatch(/\{categoryLabel\(listing\.category\)\}/);
  });

  it('the public listing page still imports no store — only the i18n seam', () => {
    const src = read('pages/PublicListing.tsx');
    expect(src).not.toMatch(/from '\.\.\/store/);
    expect(src).toMatch(/import \{ m \} from '\.\.\/lib\/i18n';/);
    // keys by index: a function's name is not stable once the bundle is minified
    expect(src).toMatch(/OFFER_POINTS\.map\(\(point, i\) => \(\s*<li key=\{i\}/);
  });
});

describe('SQEM-607 — numbers and dates in the app language', () => {
  it('no en-US formatting left on these pages', () => {
    for (const f of ['pages/Files.tsx', 'pages/Overview.tsx', 'components/AiUsageBar.tsx', 'lib/credits.ts', 'components/ui/UsageBar.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/'en-US'/);
      expect(src, f).not.toMatch(/toLocaleDateString\(undefined/);
    }
    expect(read('pages/Files.tsx')).toMatch(/toLocaleString\(getLocale\(\), \{ minimumFractionDigits: 1, maximumFractionDigits: 1 \}\)/);
  });
});

describe('SQEM-607 — glossary: „Owner“ is „Eigentümer“', () => {
  it('no German text says Owner any more', () => {
    expect(JSON.stringify(de)).not.toMatch(/\bOwner\b/);
    expect(de.ed_owner).toBe('Eigentümer');
    expect(en.ed_owner).toBe('Owner');
  });
});
