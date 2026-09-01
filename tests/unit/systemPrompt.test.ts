import { describe, it, expect } from 'vitest';
import { MCP_SYSTEM_PROMPT } from '../../constants';

// SQEM-303 — the prompt a person pastes into ChatGPT or Claude.
describe('MCP_SYSTEM_PROMPT', () => {
  // ⛔ An external limit, not a style rule. Claude's *organization instructions* — the only setting
  // either vendor documents as applying to every conversation for every member — cap at 3,000
  // characters. Over that, the org-wide use is impossible, and org-wide is the whole point for a
  // team. Verified against Anthropic's help centre on 2026-08-31.
  it('fits inside Claude organization instructions (3,000 characters)', () => {
    expect(MCP_SYSTEM_PROMPT.length).toBeLessThan(3000);
  });

  // The tool names are a contract with `supabase/functions/mcp-server`. Renaming a tool there and
  // not here leaves a prompt that instructs the model to call something that does not exist.
  it('names the tools the MCP server actually exposes', () => {
    expect(MCP_SYSTEM_PROMPT).toContain('search_templates');
    expect(MCP_SYSTEM_PROMPT).toContain('get_template');
  });

  // ⚠️ Claude's organization instructions take precedence over a person's own. Since this text will
  // often *be* the org instruction, it has to yield explicitly — otherwise we override what somebody
  // deliberately set for themselves, from a settings page they never saw.
  it('yields to the person rather than overriding them', () => {
    expect(MCP_SYSTEM_PROMPT).toContain('does not replace it');
    expect(MCP_SYSTEM_PROMPT).toContain('follow theirs');
  });

  // ⛔ Ships to self-host, where the endpoint is the operator's own machine.
  it('hard-codes no URL and no workspace', () => {
    expect(MCP_SYSTEM_PROMPT).not.toMatch(/https?:\/\//);
    expect(MCP_SYSTEM_PROMPT).not.toMatch(/sqemes\.com|supabase\.co/);
  });

  // ⚠️ Owner's decision, 2026-08-31: on several matches the model asks instead of picking. A template
  // is the organisation's agreed way of doing the work, so a silent wrong choice produces something
  // that looks sanctioned and is not.
  //
  // ⛔ "wait for the answer" is the load-bearing half. Without it a model asks and then answers
  // anyway — worse than not asking, because the choice now looks confirmed.
  it('asks on an ambiguous match instead of choosing', () => {
    expect(MCP_SYSTEM_PROMPT).toContain('ask which one fits best');
    expect(MCP_SYSTEM_PROMPT).toContain('wait for the answer');
    expect(MCP_SYSTEM_PROMPT).not.toMatch(/pick the most specific/i);
  });

  it('covers all three kinds, since a reader has to tell them apart', () => {
    for (const kind of ['prompt', 'assistant', 'skill']) {
      expect(MCP_SYSTEM_PROMPT).toContain(kind);
    }
  });
});
