import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-468 — **this file is a record of a failed experiment, and a guard against repeating it.**
 *
 * The question was whether the MCP server alone can make a client consult the library, with no
 * custom instructions in the account. Two measurements answered it, both with the account's custom
 * instructions switched **off**, same six requests, same workspace:
 *
 * | # | request | before (2026-09-24) | after the change (2026-09-26) |
 * |---|---|---|---|
 * | 1 | "Schreib eine Absage an einen Bewerber." | ⛔ no | ⛔ no |
 * | 2 | "Hast du einen Skill für Angebotserstellung?" | ✅ yes | ✅ yes |
 * | 3 | "Wie machen wir das bei uns mit Reklamationen?" | ⛔ no | ⛔ no |
 * | 4 | "Ich brauch jemanden, der Angebote schreibt." | ✅ yes | ⛔ **no — lost** |
 * | 5 | "Nutz die Sales-Persona." | ✅ yes | ✅ yes |
 * | 6 | "Überarbeite diesen Text." | ⛔ no | ⛔ no |
 *
 * **3 of 6 → 2 of 6.** The change — trigger first, shorter, lookups covered, the `include_files`
 * paragraph moved to `get_template` — improved nothing and cost case 4. It was reverted on
 * 2026-09-26; the descriptions here are the ones that measured better.
 *
 * ⛔ **THE FINDING THAT CLOSES THIS DIRECTION.** `LIBRARY_SYSTEM_PROMPT` in
 * `supabase/functions/_shared/libraryPrompt.ts` is handed to a connecting client as
 * `initialize.instructions` **and** offered on the Settings page to paste into the client's own
 * standing instructions. Byte-identical text, two channels: pasted it works, sent by the server it
 * does not. **So the wording was never the variable — the channel is.** That also disproves the
 * "dilution" hypothesis this change was built on: shortening the description changed nothing for the
 * better, because length was not the cause.
 *
 * ⚠️ **Therefore: do not spend another round on the trigger wording.** Rewriting these descriptions
 * to be more insistent, more explicit, or shorter has been measured twice and moved nothing. The
 * three levers an MCP server actually has are `initialize.instructions` (ignored), the tool
 * descriptions (fire only on our own vocabulary — "Skill" — or role-shaped phrasing, cases 2/4/5),
 * and the tool result (too late; it exists only after a call). **None can force a call.** What the
 * channel can promise is written down in `pm/DOCUMENTATION.md` in the source repository; the honest
 * maximum is "very likely in recognisable cases", and the pasted instruction closes the rest.
 *
 * ⚠️ **On the sample size, stated so nobody over-reads it:** six requests, one run each, and tool
 * choice is not deterministic — a single flip *could* be noise. The revert does not rest on case 4
 * being a certainty; it rests on the change having to show an improvement and showing none. That
 * asymmetry is the whole argument, and it is why this file pins the older wording rather than
 * declaring a winner.
 *
 * ⛔ **SQEM-526 (2026-10-19) — the guidelines now decide, not the wording experiment.** MCP client
 * guidelines say a server must not push a client into calls the user did not ask for. "Call this first
 * whenever the user asks you to write …", "adopt it for the rest of the task" and the server's
 * `initialize.instructions` ("Before you write … first search the Sqemes playbooks") went. The
 * measurement above is what made that cheap: the server channel was already ignored, and the trigger
 * sentence was kept only because a shorter variant measured worse, not because it worked. What reaches
 * a client on its own is the pasted instruction from Settings — which is exactly the one channel the
 * guidelines leave us, because a person puts it there on purpose.
 */
const ROOT = resolve(__dirname, '../../');
const src = readFileSync(resolve(ROOT, 'supabase/functions/mcp-server/index.ts'), 'utf8');

function description(tool: string): string {
  const at = src.indexOf(`name: '${tool}'`);
  expect(at, `tool '${tool}' is gone`).toBeGreaterThan(-1);
  const from = src.indexOf('description:', at);
  return src.slice(from, src.indexOf('\n', from));
}

describe('SQEM-526 — descriptions say when a tool fits; nothing tells Claude to call it', () => {
  it('⛔ search_templates no longer orders a call before every writing task', () => {
    const d = description('search_templates');
    expect(d).not.toMatch(/Call this first|whenever the user asks|ALWAYS call/);
    expect(d).toMatch(/Useful when the user wants to use, find or check one of their team\\'s playbooks/); // escaped in source
  });

  it('⛔ get_persona describes what it loads instead of telling Claude to adopt it', () => {
    expect(description('get_persona')).not.toMatch(/adopt it/);
  });

  it('⛔ the MCP server hands out no session instruction; Settings still offers the text to paste', () => {
    const prompt = readFileSync(resolve(ROOT, 'supabase/functions/_shared/libraryPrompt.ts'), 'utf8');
    const mcp = readFileSync(resolve(ROOT, 'supabase/functions/mcp-server/index.ts'), 'utf8');
    const settings = readFileSync(resolve(ROOT, 'pages/Settings.tsx'), 'utf8');
    const init = mcp.slice(mcp.indexOf('function initializeResult()'), mcp.indexOf('serverInfo:', mcp.indexOf('function initializeResult()')));
    expect(prompt).toMatch(/export const LIBRARY_SYSTEM_PROMPT/);
    expect(init).not.toMatch(/^\s*instructions:/m);
    expect(mcp).not.toMatch(/import \{ LIBRARY_SYSTEM_PROMPT \}/);
    expect(settings).toMatch(/LIBRARY_SYSTEM_PROMPT/);
    expect(settings).not.toMatch(/the one the server\s+hands to connected clients/);
  });

  it('⛔ the Settings card must not call the pasted instruction optional', () => {
    // Measured: without it, four of six cases do not fire. "optional" said the opposite of the
    // measurement, on the one screen where somebody decides whether to bother.
    const settings = readFileSync(resolve(ROOT, 'pages/Settings.tsx'), 'utf8');
    expect(settings).not.toMatch(/System prompt \(optional\)/);
  });
});
