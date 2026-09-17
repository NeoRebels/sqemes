import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  enhancePrompt, enhanceInput, describePrompt, ENHANCE_PROMPT_TEMPLATE, ENHANCE_SKILL,
  starterPromptsInstruction, starterSkillsInstruction, BRAND_VOICE_SKILL_INSTRUCTION,
  SINGLE_TEMPLATE_RULE, SINGLE_TEMPLATE_SHAPE,
} from '../../supabase/functions/_shared/authoringPrompts';

/**
 * SQEM-390 (PR B) — the texts the product hands a model when it writes for the person, pinned.
 *
 * ⛔ Pinned on what each text must SAY, not on its wording: a skill enhance that lets placeholders in
 * turns knowledge into a task; a persona enhance that permits a routing table re-creates the drift
 * SQEM-324 removed; a prompt enhance that stops preserving `{{variables}}` breaks every template it
 * touches. Those are the properties a person is paying for when they press the button.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-390 — enhance, per kind', () => {
  it('a PROMPT keeps its placeholders and is organised as a task', () => {
    const p = enhancePrompt('prompt');
    expect(p).toBe(ENHANCE_PROMPT_TEMPLATE);
    expect(p).toMatch(/Keep all \{\{variable\}\} tokens exactly as-is/);
    expect(p).toMatch(/Header → Content → Action/);
    expect(p).toMatch(/Do NOT execute/);
  });

  it('⛔ a SKILL forbids placeholders, invented facts, and is not shaped as a task', () => {
    const s = enhancePrompt('skill');
    expect(s).toBe(ENHANCE_SKILL);
    expect(s).toMatch(/Do not introduce \{\{variables\}\}/);
    expect(s).toMatch(/No invented facts/);
    expect(s).toMatch(/Scope/);
    expect(s).not.toMatch(/Header → Content → Action/);
    expect(s).toMatch(/Do NOT execute/);
  });

  it('⛔ a PERSONA forbids a routing table and treats the routes as context', () => {
    const p = enhancePrompt('persona', { routeSummary: '- Offer layout: when a quote is asked for' });
    expect(p).toMatch(/Do NOT write a routing table/);
    expect(p).toContain('- Offer layout: when a quote is asked for');
    expect(p).toMatch(/context only, do not reproduce/);
    expect(enhancePrompt('persona', { routeSummary: '' })).toContain('(none attached yet)');
  });

  it('the input is wrapped in the tag the instruction names', () => {
    expect(enhanceInput('prompt', 'x')).toBe('<prompt_template>\nx\n</prompt_template>');
    expect(enhanceInput('skill', 'x')).toBe('<skill>\nx\n</skill>');
    expect(enhanceInput('persona', 'x')).toBe('<persona_role>\nx\n</persona_role>');
    expect(enhancePrompt('prompt')).toContain('<prompt_template>');
    expect(enhancePrompt('skill')).toContain('<skill>');
  });

  it('every surface reads the module — the editor by kind, Chat the prompt variant, the persona editor its own', () => {
    const editor = code(read('pages/TemplateEditor.tsx'));
    expect(editor).toMatch(/systemInstruction: enhancePrompt\(formData\.kind\)/);
    expect(editor).toMatch(/prompt: enhanceInput\(formData\.kind, textContent\)/);
    expect(editor).toMatch(/systemInstruction: describePrompt\(formData\.kind\)/);
    const chat = code(read('pages/Chat.tsx'));
    expect(chat).toMatch(/systemInstruction: enhancePrompt\('prompt'\)/);
    expect(chat).toMatch(/promptContent: enhanceInput\('prompt', trimmed\)/);
    const persona = code(read('pages/PersonaEditor.tsx'));
    expect(persona).toMatch(/enhancePrompt\('persona', \{ routeSummary \}\)/);
    expect(persona).toMatch(/describePrompt\('persona'\)/);
    // …and none of them still carries the text inline.
    for (const [f, src] of [['TemplateEditor', editor], ['Chat', chat], ['PersonaEditor', persona]]) {
      expect(src, f).not.toMatch(/You are an expert in Prompt Engineering|You refine the role description of a PERSONA/);
    }
  });

  it('⛔ the module imports nothing — that is what lets the browser read it', () => {
    expect(code(read('supabase/functions/_shared/authoringPrompts.ts'))).not.toMatch(/^\s*import\s/m);
  });
});

describe('SQEM-390 — describe, per kind', () => {
  it('a skill description is about WHEN it applies; a persona description is a decision', () => {
    expect(describePrompt('skill')).toMatch(/WHETHER the skill applies/);
    expect(describePrompt('persona')).toMatch(/for which kind of task should someone pick this role/);
    expect(describePrompt('prompt')).toMatch(/what it does and when to use it/);
  });
});

describe('SQEM-390 — the starter library asks for quality, not just quantity', () => {
  it('⛔ prompts: role · context · task · output format, 2–4 variables, labels as QUESTIONS', () => {
    const p = starterPromptsInstruction(['Marketing & Sales', 'Data & Research', 'Business & Ops', 'Creative & Design']);
    expect(p).toMatch(/Generate exactly 4/);
    // SQEM-413 — the areas are named in the instruction and each item must carry one.
    expect(p).toContain('Marketing & Sales · Data & Research');
    expect(p).toMatch(/"area" key/);
    for (const part of ['Role:', 'Context:', 'Task:', 'Output format:']) expect(p).toContain(part);
    expect(p).toMatch(/2–4 \{\{variable_name\}\} placeholders/);
    expect(p).toMatch(/phrased as the QUESTION the person answers/);
    expect(p).toMatch(/"variables" \(an array of \{"name", "label"\}/);
    expect(p).not.toMatch(/assistant/i);
  });

  it('⛔ skills: scope · rules · examples · limits, no placeholders, no invented facts, description = when', () => {
    const s = starterSkillsInstruction(['Marketing & Sales', 'Data & Research', 'Business & Ops']);
    expect(s).toMatch(/EXACTLY ONE skill for each/);
    expect(s).toContain('Marketing & Sales · Data & Research · Business & Ops');
    expect(s).toMatch(/"area" key/);
    for (const part of ['Scope:', 'Rules:', 'Examples:', 'Limits:']) expect(s).toContain(part);
    expect(s).toMatch(/No \{\{placeholders\}\}/);
    expect(s).toMatch(/Do not invent facts/);
    expect(s).toMatch(/WHEN to apply it/);
    expect(s).not.toMatch(/assistant/i);
  });

  it('the brand voice is a skill: voice rules and before/after pairs, no placeholders', () => {
    expect(BRAND_VOICE_SKILL_INSTRUCTION).toMatch(/^Write a BRAND VOICE skill/);
    expect(BRAND_VOICE_SKILL_INSTRUCTION).toMatch(/"Voice" section with 4–6 concrete rules/);
    expect(BRAND_VOICE_SKILL_INSTRUCTION).toMatch(/before\/after pairs/);
    expect(BRAND_VOICE_SKILL_INSTRUCTION).toMatch(/No \{\{placeholders\}\}/);
  });

  it('one template from a goal: the same rules per kind, and a prompt returns its variables as questions', () => {
    expect(SINGLE_TEMPLATE_RULE.prompt).toMatch(/role, the context with \{\{variables\}\}/);
    expect(SINGLE_TEMPLATE_RULE.skill).toMatch(/Do not invent facts/);
    expect(SINGLE_TEMPLATE_SHAPE.prompt).toMatch(/phrased as the QUESTION the person answers/);
    expect(SINGLE_TEMPLATE_SHAPE.skill).toMatch(/no placeholders/);
    expect(Object.keys(SINGLE_TEMPLATE_RULE).sort()).toEqual(['prompt', 'skill']);
  });
});

/**
 * ⚠️ The one twin left: the extension's `enhance()` carries a copy of the PROMPT variant, because it
 * is a separate repo with its own release and cannot import this module. Compared here when the
 * sibling checkout is present (developer machines); green by construction in CI, where it is not —
 * the `AGENTS.md` in the source repository (Twins) says which file to change with which.
 */
const EXTENSION_API = resolve(ROOT, '../sqemes-extension/src/lib/api.ts');
describe.skipIf(!existsSync(EXTENSION_API))('SQEM-390 — the extension twin of the prompt enhance', () => {
  it('⛔ carries the PROMPT variant byte for byte', () => {
    const ext = readFileSync(EXTENSION_API, 'utf8');
    expect(ext).toContain(ENHANCE_PROMPT_TEMPLATE);
  });
});
