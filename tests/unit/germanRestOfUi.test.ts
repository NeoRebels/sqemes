import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AVAILABLE_MODELS } from '../../constants';
import { modelDescription } from '../../lib/labels';
import { en, de } from './i18nText';

/**
 * SQEM-611 — the rest of the interface in two languages: sidebar, tab titles, History, store
 * messages, error pages, import errors, model descriptions.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-611 — model descriptions (constants.ts stays an English leaf)', () => {
  it('every hover text in the model picker has a message whose English is exactly the constant', () => {
    const texts = AVAILABLE_MODELS.map(x => (x as { specs?: { description: string } }).specs?.description).filter(Boolean) as string[];
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) {
      // In English the map returns the same text — and it must come from a message, not the fallback.
      expect(modelDescription(text), text.slice(0, 40)).toBe(text);
      expect(Object.values(en), text.slice(0, 40)).toContain(text);
    }
  });

  it('the picker renders through the map', () => {
    expect(read('components/ModelSelect.tsx')).toMatch(/\{modelDescription\(hoveredModel\.specs\.description\)\}/);
  });
});

describe('SQEM-611 — the tab names the page', () => {
  const app = read('App.tsx');
  it('/history has a title (the tab said just "sqemes")', () => {
    expect(app).toMatch(/if \(pathname\.startsWith\('\/history'\)\) return m\.nav_history\(\);/);
  });

  it('/library/<id> is the listing; only /library/new and /library/<id>/edit are the editor', () => {
    expect(app).toMatch(/if \(pathname === '\/library\/new' \|\| \/\^\\\/library\\\/\[\^\/\]\+\\\/edit\$\/\.test\(pathname\)\) return m\.title_marketplace_editor\(\);\s*if \(pathname\.startsWith\('\/library\/'\)\) return m\.title_marketplace_listing\(\);/);
    expect(app).toMatch(/<Route path="\/library\/:id" element=\{<MarketplaceTemplate \/>\} \/>/);
    expect(de.title_marketplace_listing).toBe('Marktplatz-Eintrag');
  });
});

describe('SQEM-611 — what stays word for word', () => {
  it('the storage-limit message in English is still the database trigger’s sentence (SQEM-515)', () => {
    // The Cloud storage migration is not part of the self-host export — strict here, silent there (SQEM-614).
    if (!existsSync(resolve(ROOT, 'scripts/build-public-export.sh'))) return;
    const trigger = read('supabase/migrations/20261016170000_sqem515_storage_limit_cloud.sql')
      .match(/raise exception '(Storage limit reached:[^']*)'/)![1];
    // Read from the message, not by importing lib/api/files — that pulls in lib/supabase, which throws without env vars.
    expect(en.api_storage_limit.replace('{used}', '%').replace('{limit}', '%')).toBe(trigger);
    expect(read('lib/api/files.ts')).toMatch(/return m\.api_storage_limit\(\{ used: mb\(used\), limit: mb\(limit\) \}\);/);
  });

  it('⛔ the skill-root rule keeps its English twin text; the browser replaces the sentence in its wrapper', () => {
    const src = read('lib/skillBundle.ts');
    expect(src).toMatch(/No \$\{SKILL_ENTRY\} in the archive — an Agent Skill is a folder/); // findSkillRoot, twin of _shared/skillArchive.ts
    expect(src).toMatch(/candidates\.length \? \(err as Error\)\.message : m\.skb_none\(\{ entry: SKILL_ENTRY \}\)/);
  });
});

describe('SQEM-611 — German that reads as German', () => {
  it('the closing banner of the setup wizard says "in … dem sqemes-Chat" (SQEM-610 follow-up)', () => {
    expect(de.sw_ch_chat_name).toBe('dem sqemes-Chat');
  });

  it('one word for a bundle: Paket', () => {
    for (const [k, v] of Object.entries(de)) {
      if (typeof v === 'string') expect(v, k).not.toMatch(/Bundle/);
    }
  });
});
