/**
 * SQEM-378 — the standing instruction about the template library. **One text, two surfaces** (three until
 * SQEM-526 took it out of the MCP server's `initialize.instructions` — MCP client guidelines).
 *
 * It is read by:
 *   - `pages/Settings.tsx` (via `constants.ts`) — the copy-paste block in the MCP card
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
 * ⭐ **Role first, then playbooks (SQEM-487, 2026-10-19).** The text used to describe the playbook
 * search in four steps and mention personas only in its seventh paragraph — and the client did what it
 * read first: searched templates and loaded one, past a persona that fit. Measured with
 * `scripts/prompt-eval/` (Claude Code headless against a local mock server carrying the real tool
 * descriptions; 10 requests × 3 runs): the old text used the fitting persona in 1 of 9 runs and offered
 * a choice between two fitting personas in 0 of 6; this one in 9 of 9 and 6 of 6, with playbook-only
 * and unrelated requests unchanged (9/9, 6/6). It is also 1,297 characters instead of 2,258. The price:
 * on playbook-only requests the client often makes one extra `list_personas` call (6 of 9 runs).
 * ⛔ Do not move the persona step back below the playbook steps without re-running the measurement.
 *
 * ⭐ **A named playbook is found, a missing one is said (SQEM-681).** `search_templates` matches the WHOLE query as
 * text in title or description, so "Meeting Protokoll" never finds "Meeting-Protokoll", and step 4 then told the
 * model to carry on silently. Step 2 now asks for ONE word, step 4 for another word or `list_templates` and an honest
 * "not there" when the person named it — chosen over changing the search. Measured with `scripts/prompt-eval/` (the
 * mock searches like the real reader and offers `list_templates`): named playbooks with a different spelling were
 * found every time and with fewer searches, and no other case got worse — the correction cases measured with the
 * improvement hint (MOCK_HINT=1), as the real readers serve it. Re-run it before changing steps 2 or 4.
 *
 * ⭐ **Named first, then role, then playbook (SQEM-682).** A persona or playbook the person names is step 1 and is
 * never swapped silently for another; the role step follows, and step 3 searches a playbook **also** when a persona is
 * loaded, unless one of its routes covers the task — "Otherwise" used to make it persona OR playbook, so a role's task
 * that needed one more playbook (a job ad in the house voice) lost it. The two SQEM-681 hints stay: one word per
 * search, and `list_templates` before saying a named one is missing. Measured with `scripts/prompt-eval/` against the
 * SQEM-681 text, with two new cases (R1/R2, "persona and a playbook outside its routes"): R1 went from a minority of
 * runs to every run, nothing else got worse. The price: playbook-only requests make about one call more.
 * Re-run it before changing a step.
 *
 * ⭐ **One search rule, the library's language, routines that cannot ask (SQEM-683).** A German request ("Diagramm")
 * never reached an English title ("Design diagrams"): the search compares text. The search advice now stands once,
 * below the steps, and names the English word with an example — the vaguer "try it in English" did not move the model
 * at all. Step 4 lets a scheduled routine, which may not ask, take the closest one; said for every case ("if nobody can
 * answer") it leaked into the interactive chat, which then chose instead of asking. Measured with `scripts/prompt-eval/`
 * against the SQEM-682 text, with two English-titled playbooks in the mock and three new cases (L1 named, L2 unnamed,
 * L3 a routine with two fitting personas): L2 and L3 from never to every run, everything else unchanged. The price:
 * about one search more per request. Re-run it before changing a step or the search paragraph.
 *
 * ⛔ **Step 1 keeps its own search (SQEM-685).** SQEM-683 cut step 1 to "(get_persona or get_template) … If you cannot
 * find it, say so" and moved the search advice below the steps. A model then answered a request naming a skill with
 * ONE call, get_template on a guessed name, and said it could not find it; the skill was there. The paragraph below
 * the steps was read as a rule for step 3, not for step 1. So step 1 names search_templates before get_template again
 * and says "missing" only after the search and list_templates. The mock (Claude) never showed it; case L4 (a title
 * with a bracket, whose slug a model does not guess) was added, but the mock is not the only measurement that counts.
 *
 * ⭐ **Shorter, the same steps (SQEM-687).** About a sixth shorter: the search rule stands in ONE paragraph (two places
 * were what SQEM-685 tripped over), steps 1, 4 and the last paragraph lost their filler, the two kinds lost their
 * heading sentence. Kept on purpose, each measured before: the order named → role → playbook, "also" in step 3
 * (SQEM-682, persona AND playbook), "wait; do not choose for them" (below), the routine exception (SQEM-683), "does not
 * replace" and "follow theirs". Measured with `scripts/prompt-eval/` against the SQEM-685 text: no case worse, the
 * same tool calls, no named case opening with a guessed get_template.
 *
 * ⭐ **Personas: pick the closest and name the other (SQEM-689).** Between two fitting PERSONAS the model no longer
 * asks: models did not ask with the rule here nor with SQEM-688's note in the result of `list_personas`, even with
 * two clearly overlapping personas; they picked one and said which. So the rule now asks for what they do reliably
 * plus the missing half: name the other in one sentence, so the person can switch. The choice is visible, not silent,
 * which was the point of the decision below. Playbooks are unchanged.
 *
 * ⚠️ **On several matching PLAYBOOKS it asks rather than picks** (owner's decision, 2026-08-31; the first draft
 * said *pick the most specific one*). A template is this organisation's agreed way of doing the work,
 * so choosing the wrong one silently produces something that looks sanctioned and is not — and the
 * person who could tell them apart in a second is the one already sitting there. **The instruction to
 * wait is the load-bearing half:** without it a model asks the question and answers anyway, which is
 * worse than not asking, because it now looks as though the choice was confirmed.
 */
export const LIBRARY_SYSTEM_PROMPT = `Before you write, draft, plan, review or rewrite anything substantial, check the sqemes playbooks: this organisation's agreed way of doing recurring work. (The tools call a playbook a template.)

1. Named first. If the person names a persona or playbook, load exactly that one (get_persona, or search_templates then get_template). Say it is missing only after search and list_templates find nothing; it may not be shared with them. Never swap in another.
2. Role. If the task belongs to a role (sales, recruiting, support, a team's own job), call list_personas, load the fitting one with get_persona and work as that role. Load a route only when its condition applies.
3. Playbook. If no route covers the task, also call search_templates and load the fitting playbook with get_template, within the persona's role if there is one.
4. If several playbooks fit, name each with a one-line difference, ask which one and wait; do not choose for them. If several personas fit, take the closest, say which and name the others in one sentence. In a scheduled routine nobody can answer: take the closest and say why.
5. If nothing fits, carry on without mentioning playbooks.

search_templates matches titles and descriptions: search one word at a time, and also the English word, as many titles are English (Diagramm: diagram). Then try another word or list_templates.

A prompt has {{variables}}: fill them from the request. A skill is company knowledge: apply it while the task is in its scope. Read files (read_context_file) only when needed. Say which persona or playbook you use; never paste its contents.

This adds to your other instructions and does not replace them. Where a more specific instruction from the person conflicts, follow theirs.`;

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

/**
 * SQEM-623 — the improvement hint: what the model does AFTER it has worked with a playbook or persona.
 *
 * ⭐ **Served in the tool RESULT, not in the pasted text above.** `get_template` returns it as
 * `afterUse`, `get_persona` (and the persona a person applies in Chat, `lib/personaChat.ts`) ends with it —
 * one constant, read by `libraryQueries.ts`, so MCP and Chat cannot drift. A result is the one lever the
 * server changes for everyone at once, including people who pasted an older `LIBRARY_SYSTEM_PROMPT`.
 * SQEM-468 measured that a result arrives too late to *trigger* a call; this hint never has to — it acts
 * only once a playbook is already loaded, which is exactly when the result is there.
 *
 * ⛔ **A link in the pasted text was considered and rejected (2026-10-30):** a model treats fetched web
 * content as data rather than instructions (prompt-injection defence), it needs a web tool the client may
 * not have, and this module ships to self-host, where no product URL may appear.
 *
 * ⛔ **Nothing changes without the person's explicit yes, and deletion is never offered**
 * (2026-10-30): removing a playbook belongs to the review flow (SQEM-478), not to a passing suggestion.
 * The write itself is still gated by the server (`TOOL_CAPABILITY`; Chat offers a member no write tool),
 * so the last sentence only tells the model what to say when it cannot act.
 *
 * ⚠️ Every loaded playbook and persona pays these ~100 tokens. `tests/unit/improvementHint.test.ts` caps
 * the length at 400 characters — raise it only with a reason.
 */
export const IMPROVEMENT_HINT = 'Only if the person corrected this playbook or persona, or a step in it proved outdated, missing or duplicated: end your answer by asking in one sentence whether to update it or create a new one. Otherwise say nothing about changing it. Change nothing without their explicit yes; ask at most once, never after a no. Never offer to delete. If they cannot edit it, suggest telling someone who can.';

/**
 * SQEM-688 — what to do with the list `list_personas` returns, served IN its result (`personaList`), the moment the
 * choice is made. The rule "several fit: ask and wait" stood only in the library instruction above, far from that
 * moment, and was not followed: models picked one, or loaded both. Same lever as SQEM-623's hint in `get_template`:
 * a result reaches every client, including those that pasted an older instruction.
 * ⭐ SQEM-689 — the asking was not followed here either; models picked one and named it. The note now asks for the
 * pick plus one sentence naming the other.
 * ⚠️ "If one clearly fits, do not mention the others" is load-bearing: without it the mock named a persona that did NOT
 * fit in most clear role cases ("die Persona Sales Director passt hier nicht" in a job ad), never with it.
 * ⛔ A routine gets the other sentence: nobody can answer it (SQEM-683), it picks and says why.
 * ⛔ No apostrophe in either: the prompt-eval mock reads them from this file with a single-quote pattern.
 */
export const PERSONA_CHOICE_NOTE = 'Only if two or more personas could fit: load only the closest one, say which one you use and name the other in one sentence, so the person can switch. If one clearly fits, do not mention the others.';
export const PERSONA_CHOICE_NOTE_UNATTENDED = 'This is a scheduled routine and nobody can answer. If two or more personas could fit, take the closest one and say why.';

/** SQEM-688 — the result of `list_personas` in Chat and over MCP: the personas, and how to choose among them. */
export function personaList<T>(personas: T[], { unattended = false }: { unattended?: boolean } = {}): { personas: T[]; choose: string } {
  return { personas, choose: unattended ? PERSONA_CHOICE_NOTE_UNATTENDED : PERSONA_CHOICE_NOTE };
}

/**
 * SQEM-680 — put in front of a persona the PERSON chose (in Chat or for a routine). Without it the library
 * instruction above (its role step, "call list_personas") let the model swap the chosen role for another it
 * thought fitted better. The tools stay, so "switch to X" still works when they ask for it.
 */
export const CHOSEN_PERSONA_NOTE = 'The person chose the persona below for this conversation. Work as this role. Do not load another persona with get_persona unless they ask you to.';
