import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-396 — the Playbook Wizard's context section has a question over it, like the two questions
 * above, and says what Attach and Upload do BEFORE the click. SQEM-315 had explained the difference
 * under the two lists — correct, but after the choice was made.
 */
const src = readFileSync(resolve(__dirname, '../../components/TemplateWizardModal.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('SQEM-396 — the context section is labelled before the choice', () => {
  it('asks the question in the form of the other two', () => {
    expect(src).toMatch(/Which context should it draw on\?/);
    // the two questions it sits beside
    expect(src).toMatch(/What do you want to build\?/);
    expect(src).toMatch(/What do you want to achieve with your playbook\?/);
  });

  it('⛔ the hint names both ways and their difference, and sits above the buttons', () => {
    const hint = src.indexOf('Attach keeps a file on the playbook · Upload reads a document once and throws it away.');
    const buttons = src.indexOf('Attach a file');
    expect(hint).toBeGreaterThan(0);
    expect(hint).toBeLessThan(buttons);
    expect(src.slice(hint - 40, hint)).toMatch(/Optional\. $/);
  });
});
