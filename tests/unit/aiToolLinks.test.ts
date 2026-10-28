import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AI_TOOLS } from '../../lib/aiTools';
import { en } from './i18nText';

/**
 * SQEM-557 — Start links to eight AI tools with their real logos. The list is pure data and tested
 * directly; ProviderIcon imports SVG files, so the rendering side is checked at source level.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('SQEM-557 — AI tool quick links', () => {
  it('the eight tools, in this order, each on https', () => {
    expect(AI_TOOLS.map(t => t.name)).toEqual([
      'ChatGPT', 'Claude', 'Gemini', 'Grok', 'Perplexity', 'Mistral', 'DeepSeek', 'Microsoft Copilot',
    ]);
    for (const t of AI_TOOLS) expect(t.url).toMatch(/^https:\/\/[a-z.]+\/$/);
  });

  it('every logo is registered in ProviderIcon and its file exists', () => {
    const icon = read('components/ProviderIcon.tsx');
    for (const t of AI_TOOLS) {
      const m = icon.match(new RegExp(`import ${t.icon}Src from '\\.\\./assets/([^']+)'`));
      expect(m, t.icon).not.toBeNull();
      expect(icon).toMatch(new RegExp(`\\b${t.icon}: ${t.icon}Src`));
      expect(existsSync(join(root, 'assets', m![1])), m![1]).toBe(true);
    }
  });

  it('the licence note names the Copilot file and carries the MIT text', () => {
    const note = read('assets/ICONS-LICENSE.md');
    expect(note).toMatch(/`copilot-color\.svg`/);
    expect(note).toMatch(/Copyright \(c\) 2023 LobeHub/);
    expect(note).toMatch(/Permission is hereby granted, free of charge/);
  });

  it('links open in a new tab safely, say so to screen readers, and the logo is decorative', () => {
    const src = read('components/AiToolLinks.tsx');
    expect(src).toMatch(/target="_blank"\s+rel="noopener noreferrer"/);
    // SQEM-604 — the words live in messages/; the code passes the tool's name in.
    expect(src).toMatch(/aria-label=\{m\.start_tool_new_tab\(\{ name: tool\.name \}\)\}/);
    expect(en.start_tool_new_tab).toBe('{name} (opens in a new tab)');
    expect(src).toMatch(/\{tool\.short \?\? tool\.name\}/);
    expect(src).toMatch(/<ProviderIcon provider=\{tool\.icon\} alt=""/);
    expect(src).toMatch(/tool\.mono \? ' dark:invert'/);
    // The brand is lowercase except at the start of a sentence.
    expect(src).toMatch(/\{m\.start_tools_note\(\)\}/);
    expect(en.start_tools_note).toMatch(/through the sqemes extension or MCP\./); // SQEM-604
  });

  it('Start renders them under the composer', () => {
    const start = read('pages/Dashboard.tsx');
    expect(start.indexOf('<StartComposer')).toBeGreaterThan(-1);
    expect(start.indexOf('<AiToolLinks />')).toBeGreaterThan(start.indexOf('<StartComposer'));
  });
});
