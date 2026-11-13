import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  personaList, PERSONA_CHOICE_NOTE, PERSONA_CHOICE_NOTE_UNATTENDED, LIBRARY_SYSTEM_PROMPT,
} from '../../supabase/functions/_shared/libraryPrompt';

/**
 * SQEM-688 — between two fitting personas the model asks instead of choosing; SQEM-689 — it picks the closest and names the other. The rule goes into the result of
 * list_personas, the moment the choice is made, in Chat and over MCP alike; a routine, which nobody can answer, picks.
 */
const read = (p: string) => readFileSync(p, 'utf8');

describe('the rule in the list', () => {
  // SQEM-689 — asking was not followed; the note asks for the pick, ONE persona, and the other named.
  it('loads only the closest of several and names the other, so the person can switch', () => {
    expect(PERSONA_CHOICE_NOTE).toMatch(/Only if two or more personas could fit: load only the closest one, say which one you use and name the other in one sentence, so the person can switch\./);
    // ⚠️ Without it the mock named a persona that did not fit in most clear role cases.
    expect(PERSONA_CHOICE_NOTE).toMatch(/If one clearly fits, do not mention the others\./);
    expect(PERSONA_CHOICE_NOTE).not.toMatch(/\bwait\b/);
  });
  it('a routine picks and says why, and is never told to ask', () => {
    expect(PERSONA_CHOICE_NOTE_UNATTENDED).toMatch(/take the closest one and say why/);
    expect(PERSONA_CHOICE_NOTE_UNATTENDED).not.toMatch(/\bask\b/);
  });
  it('the result carries the list and the rule; a routine gets its own sentence', () => {
    const ps = [{ id: '1', name: 'sales_director' }];
    expect(personaList(ps)).toEqual({ personas: ps, choose: PERSONA_CHOICE_NOTE });
    expect(personaList(ps, { unattended: true })).toEqual({ personas: ps, choose: PERSONA_CHOICE_NOTE_UNATTENDED });
  });
  it('short, paid on every list_personas, and readable by the eval mock (no apostrophe)', () => {
    for (const s of [PERSONA_CHOICE_NOTE, PERSONA_CHOICE_NOTE_UNATTENDED]) {
      expect(s.length).toBeLessThanOrEqual(300);
      expect(s).not.toContain("'");
    }
  });
  it('the library instruction is not the place: it stays as SQEM-687 measured it', () => {
    expect(LIBRARY_SYSTEM_PROMPT).not.toContain(PERSONA_CHOICE_NOTE);
  });
});

describe('wiring', () => {
  it('Chat and MCP build the result in the same place', () => {
    expect(read('supabase/functions/_shared/libraryTools.ts')).toMatch(/case 'list_personas':[^\n]*\n\s*return bound\(JSON\.stringify\(personaList\(await lib\.listPersonas\(\), \{ unattended \}\)\)\);/);
    expect(read('supabase/functions/_shared/libraryActions.ts')).toMatch(/libraryResult\(id, async \(\) => personaList\(await lib\.listPersonas\(\)\)\)/);
  });
  it('chat-message marks a routine run as unattended', () => {
    expect(read('supabase/functions/chat-message/index.ts')).toMatch(/unattended: !!routine,/);
  });
  it('the eval mock answers in the same shape, with the routine sentence for the routine case', () => {
    const mock = read('scripts/prompt-eval/mock-mcp.mjs');
    expect(mock).toMatch(/PERSONA_CHOICE_NOTE = '\(\[\^'\]\*\)'/);
    expect(mock).toMatch(/return \{ personas: PERSONAS\.map[\s\S]*choose: process\.env\.MOCK_UNATTENDED === '1' \? CHOOSE_UNATTENDED : CHOOSE \}/);
    expect(read('scripts/prompt-eval/run.mjs')).toMatch(/MOCK_UNATTENDED: c\.type === 'routine' \? '1' : ''/);
  });
});
