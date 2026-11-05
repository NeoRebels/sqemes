import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * SQEM-645 — `ui/Switch` has a compact size for dense lists. Measured at 1440 and 390 px: 36 × 20 px,
 * 16 px knob with 2 px on every side, the ::after touch target 24 px high (`hit-24`).
 */
const sw = readFileSync('components/ui/Switch.tsx', 'utf8');

describe('SQEM-645 — the compact switch', () => {
  it('sm is 20 × 36 with a 16 px knob that travels 16 px; md is unchanged', () => {
    expect(sw).toMatch(/size = 'md'/);
    expect(sw).toMatch(/\$\{sm \? 'h-5 w-9 hit-24' : 'h-6 w-11'\}/);
    expect(sw).toMatch(/\$\{sm \? 'h-4 w-4' : 'h-5 w-5'\}/);
    expect(sw).toMatch(/\(sm \? 'translate-x-4' : 'translate-x-5'\)/);
  });

  it('hit-24 needs a positioned element — the switch is relative', () => {
    expect(sw).toMatch(/className=\{`relative inline-flex/);
  });

  it('the plug menu and the persona editor use it; Settings keep the large one', () => {
    for (const p of ['pages/Chat.tsx', 'pages/PersonaEditor.tsx']) {
      expect(readFileSync(p, 'utf8')).toMatch(/size="sm"/);
    }
    expect(readFileSync('pages/Settings.tsx', 'utf8')).not.toMatch(/<Switch[^>]*size="sm"/);
  });
});
