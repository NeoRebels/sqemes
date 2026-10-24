import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** SQEM-568 — phone layouts. */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('SQEM-568 — mobile polish', () => {
  it('filters carry the search field’s 42 px themselves instead of borrowing the row’s height', () => {
    const sf = read('components/ui/SelectFilter.tsx');
    expect(sf).toMatch(/self-stretch min-h-\[2\.625rem\]/);
    const classNames = [...sf.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)].map(m => m[1]).join(' ');
    expect(classNames).not.toMatch(/\bh-full\b/);
    expect(read('pages/Files.tsx')).toMatch(/min-h-\[2\.625rem\][^\n]*\n[^\n]*ArrowUpDown/);
  });

  it('Overview grids cannot be widened past the screen by a long title', () => {
    const ov = read('pages/Overview.tsx');
    expect(ov).toMatch(/className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6"/);
    expect(ov).toMatch(/className="grid grid-cols-1 gap-6 lg:grid-cols-3"/);
  });

  it('Settings: one sideways-scrolling row below lg, the active tab kept in view; the list from lg', () => {
    const st = read('pages/Settings.tsx');
    expect(st).toMatch(/className="lg:hidden overflow-x-auto[^"]*"/);
    expect(st).toMatch(/className="flex gap-1 w-max bg-surface-sunken rounded-xl p-1"/);
    expect(st).toMatch(/scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest' \}\)/);
    expect(st).toMatch(/<Card overflow className="hidden lg:block p-2">/);
  });

  it('the playbook wizard’s Prompt/Skill switch is as wide as its tabs, not the dialog', () => {
    expect(read('components/TemplateWizardModal.tsx')).toMatch(/<SegmentedTabs<PromptKind> tabs=\{KINDS\}[^>]*className="mb-5 w-fit"/);
  });

  it('MCP client tabs scroll sideways on a phone and wrap from sm', () => {
    const g = read('components/McpClientGuide.tsx');
    expect(g).toMatch(/overflow-x-auto[^"]*sm:overflow-visible/);
    expect(g).toMatch(/className="w-max sm:w-auto sm:flex-wrap/);
  });
});
