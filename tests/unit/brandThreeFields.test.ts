import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { starterPromptsInstruction, starterSkillsInstruction, BRAND_VOICE_SKILL_INSTRUCTION } from '../../supabase/functions/_shared/authoringPrompts';

/**
 * SQEM-395 — the brand profile is three facts: name, what it does, audience (plus the website that
 * fills them). "Tone of your playbooks" (a 1–5 level the website analysis guessed and nobody chose)
 * and "What do you want to use AI for?" (the Playbook Wizard's question, per playbook) are gone —
 * from the form, the type, every generation prompt and Adapt to brand.
 *
 * ⛔ Adapt to brand reads the brand FIELDS, not the brand-voice skill (owner, 2026-09-13: a person
 * may well delete that skill; the fields in Settings → Brand are what they maintain).
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn(), auth: {}, functions: {} } }));
const runAuthoringAI = vi.fn();
vi.mock('../../lib/authoringAI', () => ({
  runAuthoringAI: (...args: unknown[]) => runAuthoringAI(...args),
  firstTextModelId: () => 'gpt-test',
}));
const { generateStarterLibrary } = await import('../../lib/wizardGeneration');
const { adaptToBrand } = await import('../../lib/adaptTemplate');

describe('SQEM-395 — the form and the type', () => {
  it('the shared form has the three fields and the website, and nothing else', () => {
    const form = code(read('components/BrandProfileForm.tsx'));
    expect(form.match(/<input value=\{value\.\w+\}/g)?.length).toBe(3);
    expect(form).toMatch(/type="url"/);
    expect(form).not.toMatch(/tone|useCase|<select/i);
  });

  it('BrandProfile, BrandFormValue and BrandInput carry neither tone nor useCase', () => {
    const types = code(read('types.ts'));
    const profile = types.match(/export interface BrandProfile \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(profile).not.toMatch(/tone|useCase/);
    expect(types).not.toMatch(/export type ToneLevel/);
    expect(existsSync(resolve(ROOT, 'lib/toneLabels.ts'))).toBe(false);
    const gen = code(read('lib/wizardGeneration.ts'));
    const input = gen.match(/export interface BrandInput \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(input).not.toMatch(/tone|useCase/);
  });

  it('the three callers stopped passing them', () => {
    for (const f of ['components/WizardCreateStep.tsx', 'components/TemplateWizardModal.tsx', 'pages/Settings.tsx']) {
      expect(code(read(f)), f).not.toMatch(/\btone:|useCase:/);
    }
  });
});

describe('SQEM-395 — what the model is told', () => {
  beforeEach(() => { runAuthoringAI.mockReset(); });

  it('⛔ the brand summary is three lines — no Tone, no use case', async () => {
    const prompts: string[] = [];
    runAuthoringAI.mockImplementation(async ({ prompt }: { prompt: string }) => { prompts.push(prompt); return '[]'; });
    await generateStarterLibrary({ brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers' }, { workspaceId: 'ws', modelId: 'm' });
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).toBe('Brand name: Acme\nWhat it does: sells widgets\nAudience: buyers');
    }
  });

  it('the starter instructions no longer mention a use case; the brand voice infers the tone', () => {
    expect(starterPromptsInstruction(4)).not.toMatch(/use case/i);
    expect(starterSkillsInstruction(3)).not.toMatch(/use case/i);
    expect(BRAND_VOICE_SKILL_INSTRUCTION).toMatch(/Infer the tone from how the brand describes itself/);
    expect(BRAND_VOICE_SKILL_INSTRUCTION).not.toMatch(/at the given tone/);
  });

  it('the website analysis asks for the three fields only', () => {
    const gen = code(read('lib/wizardGeneration.ts'));
    expect(gen).toMatch(/keys "brandName" \(string\), "whatItDoes" \(one sentence\), and "audience" \(string\)/);
    expect(gen).not.toMatch(/clampTone/);
  });

  it('⛔ Adapt to brand reads the three fields — no tone line, no skill', async () => {
    let seen = '';
    runAuthoringAI.mockImplementation(async ({ systemInstruction }: { systemInstruction: string }) => { seen = systemInstruction; return 'adapted'; });
    await adaptToBrand('Write to {{name}}', 'prompt', { brandName: 'Acme', whatItDoes: 'sells widgets', audience: 'buyers' }, { workspaceId: 'ws', modelId: 'm' });
    expect(seen).toContain('Brand name: Acme');
    expect(seen).toContain('Audience: buyers');
    expect(seen).not.toMatch(/Preferred tone|use case|skill/i);
  });
});
