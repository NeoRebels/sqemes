/**
 * SQEM-378 — the standing instruction about the template library. **One text, three surfaces.**
 *
 * It is read by:
 *   - `pages/Settings.tsx` (via `constants.ts`) — the copy-paste block in the MCP card
 *   - `supabase/functions/mcp-server` — the `initialize.instructions` a connecting client is handed
 *   - `supabase/functions/chat-message` — in front of the system instruction of every Chat message
 *     **that actually carries the library tools**
 *
 * ⛔ **It existed twice before this and the two had drifted.** `constants.ts` held one wording, the
 * MCP server's `instructions` another; neither knew about the other, and only the second one had
 * learned about personas (SQEM-324). Two texts with one job is the shape every twin in this repo
 * starts as.
 *
 * ⭐ **And this is a real shared module, not a twin with a comparison test.** `lib/storageKey.ts`
 * justifies its twin with *"the Deno edge functions and the browser bundle share no module system"* —
 * for an **import-free** module that is not true, and it was measured rather than assumed on
 * 2026-09-10: `constants.ts` importing from here resolves under `npx tsc --noEmit` and bundles under
 * `vite build`. A comparison test is the fallback for when an import is impossible; here it is not.
 *
 * ⚠️ **The direction matters.** The canonical text lives here and the frontend imports it — never the
 * other way round. An edge function importing `constants.ts` would reach outside its own deploy tree.
 *
 * ⛔ **Under 3,000 characters, and that is a hard external limit, not a style preference.** Claude's
 * *organization instructions* — the only setting either vendor documents that applies to **every**
 * conversation for **every** member (Team and Enterprise, admins only) — cap at 3,000. Longer and the
 * org-wide use, which is the whole point for a team, becomes impossible.
 * `tests/unit/systemPrompt.test.ts` pins it.
 *
 * ⛔ **It does nothing on its own.** It instructs a model to use tools it can only reach through a
 * configured MCP connection, or through Chat's own tool loop (SQEM-373). That is why the UI shows it
 * inside the MCP card and not as a feature of its own — a copied text that silently achieves nothing
 * is worse than no text. For the same reason `chat-message` adds it **only when the library tools are
 * actually attached**: a model told to search a library it cannot reach invents the answer instead of
 * saying it cannot, which is the failure SQEM-326 records for unreachable persona routes.
 *
 * ⚠️ **The last paragraph is load-bearing.** Claude's organization instructions take **precedence**
 * over a person's own; individual instructions only fill what the org text does not address. Since
 * this text will often *be* the org instruction, it has to yield explicitly — otherwise we would be
 * overriding what someone deliberately set for themselves, from a settings page they never saw.
 *
 * ⛔ **No product URL and no workspace name.** The MCP endpoint on a self-hosted instance is the
 * operator's own, and this string ships to self-host with everything else.
 *
 * ⚠️ **The wording is deliberately surface-neutral** (SQEM-378). It used to say *"the **connected**
 * Sqemes template library"* and *"the search_templates **tool**"* — written for somebody else's
 * client, and wrong inside Sqemes' own chat, where nothing is "connected". Splitting it into two
 * variants would have re-created the drift this module exists to end.
 *
 * The tool names are real (`search_templates`, `get_template`, `list_personas`, `get_persona` in
 * `supabase/functions/mcp-server` and `_shared/libraryTools.ts`). If they are ever renamed, this text
 * is a caller and must be renamed with them.
 *
 * ⚠️ **On several matches it asks rather than picks** (owner's decision, 2026-08-31; the first draft
 * said *pick the most specific one*). A template is this organisation's agreed way of doing the work,
 * so choosing the wrong one silently produces something that looks sanctioned and is not — and the
 * person who could tell them apart in a second is the one already sitting there. **The instruction to
 * wait is the load-bearing half:** without it a model asks the question and answers anyway, which is
 * worse than not asking, because it now looks as though the choice was confirmed.
 */
export const LIBRARY_SYSTEM_PROMPT = `Before you write, draft, plan, review or rewrite anything substantial — an email, a specification, a message, a review, a piece of code — first search the Sqemes template library for a matching template, and follow it if one exists.

Sqemes holds this organisation's agreed way of doing recurring work. A template there is not a suggestion: it encodes the structure, tone and wording that have already been decided, so reusing one is better than improvising something equivalent.

How to use it:
1. Search with a keyword from the request (search_templates).
2. If exactly one template matches, load it with get_template and follow it.
3. If several match, ask which one fits best before you continue. Name them, give each a one-line difference, and wait for the answer — do not choose for them.
4. If nothing matches, carry on normally. Do not force a poor fit, and do not mention the library.

Whenever you use a template, say which one.

Templates come in three kinds and are used differently:
- A prompt is a task with {{variables}}. Fill them from the request; ask only for what you genuinely cannot infer.
- An assistant is a standing role with a system instruction and context files. Adopt it for the rest of the task.
- A skill is a reusable block of company knowledge. Apply it in addition to whatever else you are doing.

Sqemes may also define personas: working roles that bundle several templates behind conditions saying which one to load when. If someone names a persona, load it with get_persona; if a task clearly belongs to a role rather than to a single template, look first with list_personas. Adopt the persona, then load a route only once its condition applies — loading every route at once is what a persona exists to avoid.

Do not paste a template's contents into your reply unless you are asked for it. Use it, then answer.

This instruction adds to whatever else you have been told; it does not replace it. Where it conflicts with a more specific instruction from the person you are talking to, follow theirs.`;

/**
 * Puts the library instruction in front of whatever system instruction the session already has.
 *
 * ⭐ Same shape as `withTimeContext` on purpose — the two compose, and a reader who has understood
 * one has understood the other. `systemInstruction` is `undefined` whenever no assistant is applied,
 * which is most sessions; returning only the caller's value in that case would have limited the whole
 * thing to assistant sessions.
 *
 * ⛔ The CALLER decides whether to apply this at all, and must apply it only when the library tools
 * are really in the request. See the module header.
 */
export function withLibraryPrompt(systemInstruction: string | undefined): string {
  return systemInstruction
    ? `${LIBRARY_SYSTEM_PROMPT}\n\n${systemInstruction}`
    : LIBRARY_SYSTEM_PROMPT;
}
