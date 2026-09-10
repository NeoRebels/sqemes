import { describe, it, expect } from 'vitest';
import { LIBRARY_SYSTEM_PROMPT } from '../../supabase/functions/_shared/libraryPrompt';
import { LIBRARY_SYSTEM_PROMPT as VIA_CONSTANTS } from '../../constants';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SQEM-303 — the prompt a person pastes into ChatGPT or Claude.
// SQEM-378 — and the one the MCP server hands out, and the one the Sqemes chat runs under.
describe('LIBRARY_SYSTEM_PROMPT', () => {
  // ⛔ An external limit, not a style rule. Claude's *organization instructions* — the only setting
  // either vendor documents as applying to every conversation for every member — cap at 3,000
  // characters. Over that, the org-wide use is impossible, and org-wide is the whole point for a
  // team. Verified against Anthropic's help centre on 2026-08-31.
  it('fits inside Claude organization instructions (3,000 characters)', () => {
    expect(LIBRARY_SYSTEM_PROMPT.length).toBeLessThan(3000);
  });

  // The tool names are a contract with `supabase/functions/mcp-server`. Renaming a tool there and
  // not here leaves a prompt that instructs the model to call something that does not exist.
  it('names the tools the MCP server actually exposes', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toContain('search_templates');
    expect(LIBRARY_SYSTEM_PROMPT).toContain('get_template');
  });

  // ⚠️ Claude's organization instructions take precedence over a person's own. Since this text will
  // often *be* the org instruction, it has to yield explicitly — otherwise we override what somebody
  // deliberately set for themselves, from a settings page they never saw.
  it('yields to the person rather than overriding them', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toContain('does not replace it');
    expect(LIBRARY_SYSTEM_PROMPT).toContain('follow theirs');
  });

  // ⛔ Ships to self-host, where the endpoint is the operator's own machine.
  it('hard-codes no URL and no workspace', () => {
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/https?:\/\//);
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/sqemes\.com|supabase\.co/);
  });

  // ⚠️ Owner's decision, 2026-08-31: on several matches the model asks instead of picking. A template
  // is the organisation's agreed way of doing the work, so a silent wrong choice produces something
  // that looks sanctioned and is not.
  //
  // ⛔ "wait for the answer" is the load-bearing half. Without it a model asks and then answers
  // anyway — worse than not asking, because the choice now looks confirmed.
  it('asks on an ambiguous match instead of choosing', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toContain('ask which one fits best');
    expect(LIBRARY_SYSTEM_PROMPT).toContain('wait for the answer');
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/pick the most specific/i);
  });

  it('covers all three kinds, since a reader has to tell them apart', () => {
    for (const kind of ['prompt', 'assistant', 'skill']) {
      expect(LIBRARY_SYSTEM_PROMPT).toContain(kind);
    }
  });
  // ── SQEM-378 — the three surfaces, and that they really are one text ──────────────────────────

  it('⛔ the browser bundle reads the SAME module, not a copy of it', () => {
    // ⭐ The whole point of the ticket. `lib/storageKey.ts` justifies its twin with "the Deno edge
    // functions and the browser bundle share no module system"; for an import-free module that is
    // simply not true, and a real import cannot drift at all.
    expect(VIA_CONSTANTS).toBe(LIBRARY_SYSTEM_PROMPT);
  });

  it('⛔ the MCP server hands out the same text, not its own wording', () => {
    // It used to have a second, differently-worded copy — and only that copy knew about personas.
    const mcp = readFileSync(resolve(__dirname, '../../supabase/functions/mcp-server/index.ts'), 'utf8');
    expect(mcp).toMatch(/instructions:\s*LIBRARY_SYSTEM_PROMPT/);
  });

  it('⛔ the chat adds it ONLY where the library tools are attached', () => {
    // A model told to search a library it cannot reach invents the answer instead of saying it
    // cannot — the failure SQEM-326 records for unreachable persona routes.
    const chat = readFileSync(resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8');
    expect(chat).toMatch(/tools \? withLibraryPrompt\(/);
  });

  it('names the persona tools too — they were only in the server copy before', () => {
    expect(LIBRARY_SYSTEM_PROMPT).toContain('get_persona');
    expect(LIBRARY_SYSTEM_PROMPT).toContain('list_personas');
  });

  it("⚠️ the wording is surface-neutral — nothing is \"connected\"", () => {
    // It used to say "the connected Sqemes template library" and "the search_templates tool",
    // written for somebody else's client and wrong inside Sqemes' own chat.
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/connected Sqemes/);
    expect(LIBRARY_SYSTEM_PROMPT).not.toMatch(/the search_templates tool/);
  });

  it('⛔ does not name list_templates — Chat deliberately does not offer it', () => {
    // SQEM-373: the one call whose response grows with the workspace. A prompt naming a tool half
    // the surfaces lack is how a model ends up calling something that is not there.
    expect(LIBRARY_SYSTEM_PROMPT).not.toContain('list_templates');
  });
});
