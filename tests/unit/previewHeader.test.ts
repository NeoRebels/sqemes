import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-630 — beside the sidebar and the list the preview was ~70 px (768) to ~210 px (1280) wide, so a
 * title beside the action buttons broke one letter per line. The header follows the preview's own width.
 */
describe('SQEM-630 — the preview header follows the width of the preview (container query)', () => {
  for (const f of ['components/PlaybookPreview.tsx', 'components/PersonaPreview.tsx']) {
    it(f, () => {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/<article aria-labelledby="(playbook|persona)-preview-title" className="[^"]*\[container-type:inline-size\]">/);
      expect(src).toContain('<div className="flex flex-col gap-4 justify-between [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-start">');
      // ⛔ not window breakpoints — measured wrong at 768 px (sidebar) and 1280 px (list beside it)
      expect(src).not.toContain('sm:flex-row lg:flex-col');
      expect(src).toContain('<div className="flex items-center gap-2 shrink-0 flex-wrap">');
    });
  }
});
