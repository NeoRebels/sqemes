import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chosenPersonaInstruction, personaInstruction } from '../../lib/personaChat';
import { CHOSEN_PERSONA_NOTE } from '../../supabase/functions/_shared/libraryPrompt';

/** SQEM-680 — "Automatic" instead of "No persona", a chosen persona stays, the editor's "Versions" tab. */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const en = JSON.parse(read('messages/en.json'));
const de = JSON.parse(read('messages/de.json'));

describe('the persona picker says what happens without a choice', () => {
  it('Automatic / Automatisch, also in the routine summary', () => {
    expect([en.start_no_persona, de.start_no_persona]).toEqual(['Automatic', 'Automatisch']);
    expect([en.rt_sum_no_persona, de.rt_sum_no_persona]).toEqual(['persona automatic', 'Persona automatisch']);
  });
});

describe('a persona the person chose stays the role', () => {
  const persona = { title: 'Sales', description: 'Sells', content: 'You sell.', routes: [] };

  it('Chat puts the note in front of the persona; MCP get_persona text stays as it was', () => {
    const chosen = chosenPersonaInstruction(persona, []);
    expect(chosen.startsWith(`${CHOSEN_PERSONA_NOTE}\n\n`)).toBe(true);
    expect(chosen.endsWith(personaInstruction(persona, []))).toBe(true);
    expect(personaInstruction(persona, [])).not.toContain(CHOSEN_PERSONA_NOTE);
    expect(CHOSEN_PERSONA_NOTE).toMatch(/unless they ask you to/);
  });

  it('wired in Chat (both places that set it) and for a routine with a persona', () => {
    const chat = read('pages/Chat.tsx');
    expect(chat.match(/chosenPersonaInstruction\(persona, prompts\)/g)?.length).toBe(2);
    expect(chat).not.toMatch(/[^d]personaInstruction\(persona, prompts\)/);
    expect(read('supabase/functions/routine-run/index.ts')).toMatch(/personaText \? `\$\{CHOSEN_PERSONA_NOTE\}\\n\\n\$\{personaText\}` : null/);
  });
});

describe('the playbook editor: Versions first and preselected', () => {
  it('order, labels, default', () => {
    const ed = read('pages/TemplateEditor.tsx');
    expect(ed).toMatch(/\[\['history', txt\.vh_history_tab\(\), History\], \['test', txt\.ed_tab_test\(\), FlaskConical\]\]/);
    expect(ed).toMatch(/useState<'history' \| 'test'>\('history'\)/);
    expect([en.vh_history_tab, de.vh_history_tab]).toEqual(['Versions', 'Versionen']);
    expect([en.ed_tab_history_test, de.ed_tab_history_test]).toEqual(['Versions · Test', 'Versionen · Test']);
  });
});
