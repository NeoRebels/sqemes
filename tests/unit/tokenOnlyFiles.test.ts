import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-581 — files already moved to the design-system tokens stay on them.
 *
 * `designTokens.test.ts` counts colour FAMILIES outside the palette; palette steps (`slate-500`,
 * `brand-600`, `emerald-50`, …) pass it. That is how the History page (SQEM-563) and the playbook
 * editor's version tab (SQEM-581) shipped in the old look with every test green. A file listed here
 * may not use a palette step at all — add a file once it has been moved.
 */
const TOKEN_ONLY = [
  'components/VersionHistoryPanel.tsx',
  'pages/History.tsx',
  'components/RecentChatsWidget.tsx',
];
const PALETTE_STEP = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|decoration|placeholder)-(?:slate|brand|emerald|red|amber|white|black)(?:-\d{2,3})?\b/g;

describe('SQEM-581 — token-only files', () => {
  for (const f of TOKEN_ONLY) {
    it(`${f} uses tokens, no palette steps`, () => {
      const src = readFileSync(resolve(__dirname, '../..', f), 'utf8');
      expect([...src.matchAll(PALETTE_STEP)].map(m => m[0])).toEqual([]);
    });
  }

  it('the editor opens on Test, with History second', () => {
    const ed = readFileSync(resolve(__dirname, '../../pages/TemplateEditor.tsx'), 'utf8');
    expect(ed).toMatch(/useState<'history' \| 'test'>\('test'\)/);
    expect(ed).toMatch(/\[\['test', 'Test', FlaskConical\], \['history', 'History', History\]\]/);
  });

  it('the version tab confirms through ConfirmModal', () => {
    const p = readFileSync(resolve(__dirname, '../../components/VersionHistoryPanel.tsx'), 'utf8');
    expect(p).toMatch(/<ConfirmModal/);
    expect(p).not.toMatch(/import Modal from/);
  });
});
