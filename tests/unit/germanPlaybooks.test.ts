import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEMPLATE_CATEGORIES, ROLE_LABELS, KIND_HELP } from '../../constants';
import { categoryLabel, kindHelp, roleLabel } from '../../lib/labels';
import { bulkSummary } from '../../lib/bulkApply';
import { en, de } from './i18nText';

/** SQEM-605 — Playbooks in two languages: stored values, shared labels, bulk sentences. */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('SQEM-605 — a category is stored English and shown translated', () => {
  it('every category has a label in both languages, and English shows the value itself', () => {
    for (const c of TEMPLATE_CATEGORIES) {
      expect(categoryLabel(c)).toBe(c); // the test runs English
      const key = Object.keys(en).find(k => k.startsWith('category_') && en[k] === c);
      expect(key, c).toBeDefined();
      expect(de[key!]).toBeTruthy();
    }
    expect(categoryLabel('Something new')).toBe('Something new'); // an unknown value shows as it is
  });

  it('⛔ every category select stores the VALUE and shows the label', () => {
    for (const f of ['pages/Templates.tsx', 'pages/TemplateEditor.tsx']) {
      expect(read(f), f).toMatch(/<option key=\{(c|cat)\} value=\{(c|cat)\}>\{categoryLabel\((c|cat)\)\}<\/option>/);
    }
  });
});

describe('SQEM-605 — shared labels live in lib/labels.ts, constants.ts stays an English leaf', () => {
  it('constants keep the English words (gleap.ts sends ROLE_LABELS to support)', () => {
    expect(ROLE_LABELS.member).toBe('Member');
    expect(KIND_HELP.prompt).toMatch(/^A task you reuse/);
    expect(read('lib/gleap.ts')).toMatch(/ROLE_LABELS\[user\.role\]/);
  });

  it('lib/labels returns the same English, and German exists', () => {
    expect(roleLabel('member')).toBe('Member');
    expect(kindHelp('prompt')).toBe(KIND_HELP.prompt);
    expect(de.role_member).toBe('Mitglied');
  });
});

describe('SQEM-605 — bulk sentences are whole messages', () => {
  it('English unchanged', () => {
    expect(bulkSummary({ changed: ['a'], skipped: [], failed: [] }, 'persona', 'Tag removed').message).toBe('Tag removed for 1 persona');
    expect(bulkSummary({ changed: [], skipped: [], failed: [] }, 'playbook', 'x')).toEqual({ message: 'Nothing to change', type: 'info' });
  });

  it('German plural forms exist for every noun', () => {
    for (const n of ['playbook', 'persona', 'file', 'chat']) {
      expect(JSON.stringify(de[`count_${n}`])).toMatch(/countPlural=one.*countPlural=other/);
      expect(JSON.stringify(de[`bulk_selected_${n}`])).toMatch(/ausgewählt/);
    }
  });
});
