import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, de } from './i18nText';

/**
 * SQEM-610 — the setup wizard, the plan chooser and the first-workspace screen in two languages.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('SQEM-610 — the plan chooser says what the Terms say about VAT', () => {
  it('⛔ "Prices exclude VAT" is gone — it contradicted VAT_NOTE on the same cards and PRICING.md (SQEM-283)', () => {
    const screen = read('components/ChoosePlanScreen.tsx').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(screen).not.toMatch(/exclude VAT/i);
    expect(JSON.stringify(en)).not.toMatch(/exclude VAT/i);
    expect(screen).toMatch(/\{m\.stl_vat\(\)\}/);
  });
});

describe('SQEM-610 — language-specific logic left the wizard', () => {
  it('the closing banner lists the channels by their own names, joined in the app language', () => {
    const wizard = read('components/SetupWizard.tsx');
    expect(wizard).not.toMatch(/replace\(\/\^In \//);
    expect(wizard).toMatch(/new Intl\.ListFormat\(getLocale\(\), \{ style: 'long', type: 'conjunction' \}\)/);
    expect([en.sw_ch_browser_name, de.sw_ch_browser_name]).toEqual(['your browser', 'deinem Browser']);
  });

  it('generation sections stay keys; only their names are translated', () => {
    const step = read('components/WizardCreateStep.tsx');
    expect(step).toMatch(/\{ label: 'brand voice', text: m\.wc_sec_brand\(\) \}/);
    expect(step).toMatch(/sectionName\(f\.section\)/);
  });

  it('the first-workspace screen speaks of playbooks, not prompts (SQEM-394)', () => {
    expect(en.nw_cloud_body).toBe('A workspace is where your team collaborates on playbooks.');
    expect(read('App.tsx')).toMatch(/m\.nw_cloud_body\(\)/);
  });

  it('the wizard names the real settings tab', () => {
    expect(en.sw_settings_api).toBe('Settings → API & MCP');
    // line comments first, then block comments (comment-stripper-order rule)
    const code = read('components/SetupWizard.tsx').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/Settings → Integrations|Settings → MCP Server/);
  });
});
