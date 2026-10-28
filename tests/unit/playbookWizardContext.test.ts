import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-396 — the Playbook Wizard's context section has a question over it, like the two questions
 * above, and says what Attach and Upload do BEFORE the click. SQEM-315 had explained the difference
 * under the two lists — correct, but after the choice was made.
 */
const src = readFileSync(resolve(__dirname, '../../components/TemplateWizardModal.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('SQEM-396 — the context section is labelled before the choice', () => {
  // SQEM-605 — the words live in messages/*.json; the code is checked for the keys and their ORDER.
  it('asks the question in the form of the other two', () => {
    expect(src).toMatch(/m\.wiz_context\(\)/);
    expect(en.wiz_context).toBe('Which context should it draw on?');
    // the two questions it sits beside
    expect(en.wiz_what_build).toBe('What do you want to build?');
    expect(en.wiz_goal).toBe('What do you want to achieve with your playbook?');
  });

  it('⛔ the hint names both ways and their difference, and sits above the buttons', () => {
    const hint = src.indexOf('m.wiz_context_hint()');
    const buttons = src.indexOf('m.wiz_attach()');
    expect(hint).toBeGreaterThan(0);
    expect(hint).toBeLessThan(buttons);
    expect(en.wiz_context_hint).toBe('Optional. Attach keeps a file on the playbook · Upload reads a document once and throws it away.');
    expect(de.wiz_context_hint).toMatch(/^Optional\. Anhängen .* Hochladen /);
  });
});
