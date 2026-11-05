import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IMPROVEMENT_HINT, LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { composePersona } from '../../supabase/functions/_shared/libraryQueries';

/**
 * SQEM-623 — the improvement hint rides on the tool RESULT (get_template, get_persona), from one
 * constant, and never on the pasted LIBRARY_SYSTEM_PROMPT. See the note on IMPROVEMENT_HINT.
 */
describe('SQEM-623 improvement hint', () => {
  it('stays short — every loaded playbook and persona pays for it', () => {
    expect(IMPROVEMENT_HINT.length).toBeLessThanOrEqual(400);
  });

  it('⛔ asks before changing, offers once, never offers deletion', () => {
    expect(IMPROVEMENT_HINT).toContain('explicit yes');
    expect(IMPROVEMENT_HINT).toContain('at most once');
    expect(IMPROVEMENT_HINT).toContain('Never offer to delete');
  });

  it('⛔ is not part of the pasted system prompt (customers would have to re-paste it)', () => {
    expect(LIBRARY_SYSTEM_PROMPT).not.toContain(IMPROVEMENT_HINT);
  });

  it('ends a persona, under its own heading, after the routes', () => {
    const text = composePersona(
      { title: 'Sales', description: '', content: 'You sell.' },
      [{ name: 'offer', title: 'Offer', kind: 'skill', condition: 'an offer is written', description: '' }],
    );
    expect(text.endsWith(IMPROVEMENT_HINT)).toBe(true);
    expect(text.indexOf('## After the task')).toBeGreaterThan(text.indexOf('get_template(name: "offer")'));
  });

  it('ends a persona with no visible routes too', () => {
    expect(composePersona({ title: 'Empty', description: '', content: 'Role.' }, []).endsWith(IMPROVEMENT_HINT)).toBe(true);
  });

  it('⛔ one source: no reader spells the text out itself', () => {
    const src = readFileSync('supabase/functions/_shared/libraryQueries.ts', 'utf8');
    expect(src).toContain("import { IMPROVEMENT_HINT } from './libraryPrompt.ts'");
    expect(src).not.toContain('Never offer to delete');
  });
});
