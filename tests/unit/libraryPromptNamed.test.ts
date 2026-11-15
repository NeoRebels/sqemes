import { describe, it, expect } from 'vitest';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { LIBRARY_TOOL_DEFS } from '../../supabase/functions/_shared/libraryToolDefs';

/** SQEM-681 — a playbook the person names is found (one word, then list_templates), a missing one is said. */
describe('the library instruction', () => {
  // SQEM-682 — five steps; SQEM-683 — one search rule below them, with the library's language.
  it('step 1 loads a named one exactly, says when it is missing and never swaps it', () => {
    // SQEM-687 — the same rule, shorter; SQEM-690 — imperative.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/1\. Named: load exactly the persona or playbook the person names/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/Search before you say it is missing; it may not be shared with them\. Never swap it\./);
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
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/3\. Playbook: also call search_templates for anything the persona's routes do not cover/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/5\. Nothing fits: carry on without mentioning sqemes\./);
  });

  it('the routine exception lives where a routine runs, not in the pasted text (SQEM-690)', () => {
    // SQEM-683 said "if nobody can answer" for every case and the chat stopped asking; SQEM-690 drops the sentence:
    // a routine already reads "Do not ask questions" and gets the routine note from list_personas.
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/nobody can answer/);
  });

  it('the search rule lives in the search tool, not in the instruction (SQEM-690)', () => {
    // It stood in both; the tool description is what every client reads when it searches. The English word moved there.
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/one word at a time|a single word/);
    const search = (LIBRARY_TOOL_DEFS as Array<{ name: string; description: string }>).find(t => t.name === 'search_templates')!;
    expect(search.description).toMatch(/Many titles are English: also search the English word \(Diagramm: diagram\)\./);
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
