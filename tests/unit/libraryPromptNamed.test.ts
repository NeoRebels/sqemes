import { describe, it, expect } from 'vitest';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { LIBRARY_TOOL_DEFS } from '../../supabase/functions/_shared/libraryToolDefs';

/** SQEM-681 — a playbook the person names is found (one word, then list_templates), a missing one is said. */
describe('the library instruction', () => {
  it('step 2 searches one word, step 4 falls back to list_templates and says when a named one is missing', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/2\. Otherwise call search_templates with one keyword from the request — a single word;/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/4\. If the person names a playbook or persona and you cannot find it, try another word or list_templates; if it is still not there, say so/);
    expect(LIBRARY_SYSTEM_PROMPT).toMatch(/If nothing fits an unnamed task, carry on normally and do not mention the playbooks\./);
  });

  it('role first stays first (SQEM-487)', () => {
    expect(LIBRARY_SYSTEM_PROMPT.indexOf('1. Role first.')).toBeLessThan(LIBRARY_SYSTEM_PROMPT.indexOf('2. Otherwise call search_templates'));
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
