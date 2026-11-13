import { describe, it, expect } from 'vitest';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { LIBRARY_TOOL_DEFS } from '../../supabase/functions/_shared/libraryToolDefs';

/** SQEM-681 — a playbook the person names is found (one word, then list_templates), a missing one is said. */
describe('the library instruction', () => {
  // SQEM-682 — five steps; SQEM-683 — one search rule below them, with the library's language.
  it('step 1 loads a named one exactly, says when it is missing and never swaps it', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/1\. Named first\. If the person names a persona or playbook, load exactly that one/);
    // SQEM-687 — the same rule, shorter.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/Say it is missing only after search and list_templates find nothing; it may not be shared with them\. Never swap in another\./);
  });

  // SQEM-685 — without its own search, step 1 made one get_template on a guessed name and said "not found".
  it('step 1 searches before it loads a named playbook', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/load exactly that one \(get_persona, or search_templates then get_template\)/);
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/If you cannot find it, say so/);
  });

  it('step 3 searches a playbook with or without a persona', () => {
    // ⛔ "also" is SQEM-682's: a role's task that needs one more playbook gets the persona AND the playbook.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/3\. Playbook\. If no route covers the task, also call search_templates/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/within the persona's role if there is one\./);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/5\. If nothing fits, carry on without mentioning playbooks\./);
  });

  it('only a routine may pick instead of asking (SQEM-683: said for every case, the chat stopped asking)', () => {
    // SQEM-689 — the persona sentence sits between them; the routine exception still closes step 4.
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/name the others in one sentence\. In a scheduled routine nobody can answer: take the closest and say why\./);
  });

  it('the search rule stands once: one word, the English word too, then another word or list_templates', () => {
    // ⛔ ONE paragraph: split over step 1 and a paragraph, a model applied it to step 3 only (SQEM-685/687).
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/search_templates matches titles and descriptions: search one word at a time, and also the English word, as many titles are English \(Diagramm: diagram\)\. Then try another word or list_templates\./);
    expect(LIBRARY_SYSTEM_PROMPT.match(/one word at a time|a single word/g)).toHaveLength(1);
  });

  it('Chat\'s own search tool says the same', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('supabase/functions/_shared/libraryTools.ts', 'utf8')).toMatch(/matched as text in titles and descriptions, so search ONE word; with no match, try another word or list_templates/);
  });

  it('the search tool tells every MCP client the same: one word, then list_templates', () => {
    const search = (LIBRARY_TOOL_DEFS as Array<{ name: string; description: string }>).find(t => t.name === 'search_templates')!;
    expect(search.description).toMatch(/matched as text in titles and descriptions, so search ONE word/);
    expect(search.description).toMatch(/try another word or list_templates/);
  });
});
