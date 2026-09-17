import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-446 — the model list says which models your connectors reach.
 *
 * Since SQEM-436 the composer's icon describes the CHOSEN model. Someone who sees the red one then
 * has to open the list and guess which model does better; the hint belongs where the choice is made.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const SELECT = read('components/ModelSelect.tsx');
const CHAT = read('pages/Chat.tsx');

describe('SQEM-446 — connector mark in the model list', () => {
  it('⛔ it is a property, not a rule baked into the shared component', () => {
    // ModelSelect serves four callers and only one is about connectors. A green icon in a persona
    // picker would mean nothing, and a mark that means nothing is worse than no mark.
    expect(SELECT).toMatch(/connectorProviders\?: string\[\]/);
    expect(SELECT).toMatch(/connectorProviders\?\.includes\(m\.provider\)/);
    // No provider names hard-coded inside the component.
    expect(SELECT).not.toMatch(/'claude'|'openai'/);
  });

  it('only the chat passes it, and only with connectors present', () => {
    expect(CHAT).toMatch(/connectorProviders=\{connectors\.length > 0 \? \['claude', 'openai'\] : undefined\}/);
    for (const f of ['components/PersonaSelect.tsx', 'components/EditorTestPanel.tsx', 'components/ui/Modal.tsx']) {
      expect(read(f), f).not.toMatch(/connectorProviders/);
    }
  });

  it('⚠️ green only — a list of red rows reads as a list of faults', () => {
    // The composer has both states because it describes one chosen model. A list does not.
    const row = SELECT.slice(SELECT.indexOf('connectorProviders?.includes'));
    const block = row.slice(0, row.indexOf(')}'));
    expect(block).toMatch(/text-emerald-600 dark:text-emerald-400/);
    expect(block).not.toMatch(/text-red-/);
  });

  it('the mark sits before the info icon and is the same symbol as the composer', () => {
    expect(SELECT.indexOf('connectorProviders?.includes')).toBeLessThan(SELECT.indexOf('{m.specs && ('));
    expect(SELECT).toMatch(/import \{ ChevronDown, Info, Plug \} from 'lucide-react'/);
    expect(CHAT).toMatch(/<Plug className="w-4 h-4" \/>/);
  });
});
