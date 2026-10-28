import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { en } from './i18nText';

/**
 * SQEM-550 (c) — the playbook editor in redesign C's look. No new functions: the same fields, panels
 * and tabs; the title heads the document instead of opening the settings rail.
 */
const src = readFileSync(join(resolve(__dirname, '../..'), 'pages/TemplateEditor.tsx'), 'utf8');

describe('SQEM-550 (c) — the editor', () => {
  it('the title is the document head: display face, in the editor column, still labelled', () => {
    const head = src.indexOf('SQEM-550 (c) — redesign C: the title heads the document');
    const toolbar = src.indexOf('{/* Toolbar + content textarea */}');
    expect(head).toBeGreaterThan(-1);
    const block = src.slice(head, toolbar);
    expect(block).toMatch(/<label htmlFor="template-editor-title" className="sr-only">\{txt\.ed_title_label\(\)\}<\/label>/);
    expect(en.ed_title_label).toBe('Title'); // SQEM-605
    expect(block).toMatch(/<input id="template-editor-title"\s+className="[^"]*font-display/);
    expect(block).toMatch(/<KindBadge kind=\{formData\.kind\} \/>/);
    expect(src.match(/id="template-editor-title"/g)).toHaveLength(1); // moved, not copied
  });

  it('the content sits in a card in the text face, not monospace', () => {
    expect(src).toMatch(/className="flex-1 mx-4 md:mx-8 mb-4 md:mb-6 p-5 md:p-6 rounded-card border border-line bg-surface-raised/);
    expect(src).not.toMatch(/font-mono text-slate-800/);
  });

  it('header, rails and tabs use the tokens', () => {
    expect(src).toMatch(/<header className="bg-surface-raised border-b border-line h-16/);
    expect(src).toMatch(/aria-label=\{saveLabel\} className="[^"]*bg-accent-strong/);
    expect(src).toMatch(/role="tablist" className="flex border-b border-line bg-surface-raised/);
  });

  it('⛔ nothing functional went: History/Test, Enhance, Generate description, the read-only lock', () => {
    expect(src).toMatch(/<VersionHistoryPanel/);
    expect(src).toMatch(/onClick=\{handleEnhance\}/);
    expect(src).toMatch(/onClick=\{handleGenerateDescription\}/);
    expect(src).toMatch(/txt\.ed_readonly_1\(\)/);
    expect(en.ed_readonly_1).toBe('You can use this playbook but not change it.');
  });
});
