import { describe, it, expect } from 'vitest';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { LIBRARY_TOOL_DEFS } from '../../supabase/functions/_shared/libraryToolDefs';

/** SQEM-681 — a playbook the person names is found (one word, then list_templates), a missing one is said. */
describe('the library instruction', () => {
  // SQEM-682 — five steps; SQEM-683 — one search rule below them, with the library's language.
  it('step 1 loads a named one exactly, says when it is missing and never swaps it', () => {
    // SQEM-687 — the same rule, shorter; SQEM-690 — imperative.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/1\. Named: load exactly the persona or playbook the person names/);
    // SQEM-703 — the search order is back in step 1: with the new steps 3/4 a named playbook with an English title
    // was given up after two searches; this sentence restored it.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/Search one word at a time, the English word too, then list_templates, before you say it is missing; it may not be shared with them\. Never swap it\./);
  });

  // SQEM-685 — without its own search, step 1 made one get_template on a guessed name and said "not found".
  it('step 1 searches before it loads a named playbook', () => {
    // SQEM-690 — the tool names stay in step 1: the cut that dropped them is what SQEM-685 repaired.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/names \(get_persona, or search_templates then get_template\)/);
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/If you cannot find it, say so/);
  });

  it('step 3 searches a playbook with or without a persona', () => {
    // ⛔ "also" is SQEM-682's: a role's task that needs one more playbook gets the persona AND the playbook.
    // SQEM-690 — measured: without "also" the persona-plus-playbook case got worse.
    // SQEM-703 — every playbook whose condition the task meets, then the search for a part the persona does not cover.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/3\. Playbooks: load every playbook whose persona condition the task meets\. For any part of the task the persona does not cover, also call search_templates/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/5\. Nothing fits: carry on without mentioning sqemes\./);
  });

  it('the routine exception lives where a routine runs, not in the pasted text (SQEM-690)', () => {
    // SQEM-683 said "if nobody can answer" for every case and the chat stopped asking; SQEM-690 drops the sentence:
    // a routine already reads "Do not ask questions" and gets the routine note from list_personas.
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/nobody can answer/);
  });

  it('the search rule stands in the search tool, and in step 1 for a named one (SQEM-690, SQEM-703)', () => {
    // SQEM-690 moved it into the tool description; SQEM-703 measured that a named playbook needs it in step 1 too.
    // The tool description carries no example since SQEM-703 (measured without loss).
    const search = (LIBRARY_TOOL_DEFS as Array<{ name: string; description: string }>).find(t => t.name === 'search_templates')!;
    expect(search.description).toMatch(/so search ONE word of the request, never a phrase; with no match, try another word or list_templates\. Many titles are English: also search the English word for it\./);
    expect(search.description).not.toMatch(/Diagramm|protokoll/);
  });

  it('Chat\'s own search tool says the same', async () => {
    const { readFileSync } = await import('node:fs');
    const chat = readFileSync('supabase/functions/_shared/libraryTools.ts', 'utf8');
    expect(chat).toMatch(/matched as text in titles and descriptions, so search ONE word; with no match, try another word or list_templates/);
    expect(chat).toMatch(/Many titles are English: also search the English word \(Diagramm: diagram\)\./);
    // SQEM-690 — the same widening as the instruction: any task, not only writing.
    expect(chat).toMatch(/'Call this before a task — /);
  });

  it('the search tool tells every MCP client the same: one word, then list_templates', () => {
    const search = (LIBRARY_TOOL_DEFS as Array<{ name: string; description: string }>).find(t => t.name === 'search_templates')!;
    expect(search.description).toMatch(/matched as text in titles and descriptions, so search ONE word/);
    expect(search.description).toMatch(/try another word or list_templates/);
  });
});
