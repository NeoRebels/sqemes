import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-332 — the two halves of the MCP tool surface must name the same tools.
 *
 * `tools/list` builds an array of tool definitions; `TOOL_CAPABILITY` says which permission each
 * one needs. Nothing connected them except a developer remembering, and when the persona tools were
 * added to the array and not to the map, the omission failed in **both** directions at once:
 *
 *   * `tools/list` filters on `scopes.includes(TOOL_CAPABILITY[name])` → `undefined` → the tool was
 *     **never advertised**, which is how it was eventually noticed (a user asked where it was);
 *   * `tools/call` guarded with `if (requiredCap && …)` → falsy → the scope check was **skipped
 *     entirely**, which nobody would have noticed, because skipping a check looks like success.
 *
 * ⚠️ **This test reads the source file as text rather than importing it.** `mcp-server/index.ts`
 * calls `Deno.serve` at module load, so it cannot be imported into vitest at all — and a test that
 * needs a stand-in for the thing it is testing tests the stand-in. Reading the file is cruder and
 * checks the real artefact.
 */

// ⚠️ Resolved from the working directory, not from `import.meta.url`: under the jsdom environment
// vitest hands this file a non-`file:` URL, and `fileURLToPath` throws before a single test runs.
// Vitest always runs from the repository root.
const SRC = readFileSync(resolve(process.cwd(), 'supabase/functions/mcp-server/index.ts'), 'utf8');

/**
 * The same source with comments removed.
 *
 * ⛔ **Found by the negative check on SQEM-340, and it is the whole reason this exists.** The test
 * for `delete_file`'s authority gate asserted the body contained `hasWriteAuthority` — and it still
 * passed after the guard was deleted, because the explanatory comment above it *names* the rule.
 * The test was matching prose, not code: exactly the failure it was written to prevent, one level up.
 *
 * ⚠️ `mcp-server/index.ts` carries unusually dense commentary — every guard has a paragraph saying
 * what it is and why. That is a virtue in the source and a trap for a text-based test, so every
 * body extractor below strips comments first.
 *
 * The line-comment pattern is anchored to the start of a line, so a `https://` inside a string
 * survives.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The keys of the `TOOL_CAPABILITY` record. */
function capabilityNames(): string[] {
  const block = SRC.match(/const TOOL_CAPABILITY: Record<string, Capability> = \{([\s\S]*?)\n\};/);
  expect(block, 'TOOL_CAPABILITY block not found — did the declaration change?').toBeTruthy();
  return [...block![1].matchAll(/^\s{2}([a-z_]+):\s*'(read|create|update|delete)'/gm)].map(m => m[1]);
}

/**
 * The `name:` of every tool definition in the `tools/list` array.
 *
 * Anchored on the eight-space indentation the array's entries use, so `serverInfo.name` and the
 * `name` properties inside an `inputSchema` cannot be mistaken for tools.
 */
function advertisedNames(): string[] {
  const start = SRC.indexOf("if (method === 'tools/list')");
  const end = SRC.indexOf('return rpcResult(id, { tools: visibleTools });');
  expect(start, 'tools/list branch not found').toBeGreaterThan(-1);
  expect(end, 'tools/list return not found').toBeGreaterThan(start);
  const block = SRC.slice(start, end);
  return [...block.matchAll(/^ {8}name: '([a-z_]+)',$/gm)].map(m => m[1]);
}

describe('MCP tool surface', () => {
  it('advertises at least the tools we know shipped', () => {
    const advertised = advertisedNames();
    expect(advertised).toContain('list_templates');
    expect(advertised).toContain('list_personas');
    expect(advertised).toContain('get_persona');
    expect(advertised.length).toBeGreaterThanOrEqual(14);
  });

  it('gives every advertised tool a capability', () => {
    const missing = advertisedNames().filter(n => !capabilityNames().includes(n));
    // ⛔ A tool missing here is invisible in tools/list AND ungated in tools/call.
    expect(missing, `tools missing from TOOL_CAPABILITY: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no capability entry for a tool that is not advertised', () => {
    const orphans = capabilityNames().filter(n => !advertisedNames().includes(n));
    // Less dangerous, but it means the map describes a tool that no longer exists — the next
    // person reading it would look for one.
    expect(orphans, `capabilities without a tool: ${orphans.join(', ')}`).toEqual([]);
  });

  it('refuses an unknown tool instead of waving it through', () => {
    // The fix that matters: `if (!requiredCap) return rpcError(...)`. Pinned as text because the
    // module cannot be imported — if this shape changes, the guard must be re-read, not assumed.
    expect(SRC).toMatch(/if \(!requiredCap\) \{\s*\n\s*return rpcError\(id, -32601/);
  });
});

/**
 * SQEM-336 — a tool that WRITES to an existing object must check the caller may see it.
 *
 * Reading was filtered from SQEM-142 on, and `delete_file` has checked since SQEM-291 with the
 * reason written beside it. `update_template` and `delete_template` never got the same treatment:
 * both scoped to `workspace_id` alone, so a connection could overwrite or destroy a template it was
 * not allowed to read. Nothing failed, so nothing reported it — the same shape as SQEM-332.
 *
 * ⚠️ This test exists because the *next* write tool is the real risk. SQEM-337 and SQEM-338 add
 * five more (`create/update/delete_persona`, `attach/detach_template`), and a rule that lives only
 * in a reviewer's memory is how this gap appeared in the first place.
 *
 * `create` is deliberately out of scope: it operates on no existing row, so there is nothing to be
 * allowed to see. Ownership on creation is SQEM-240's subject, not this one's.
 */
describe('MCP write authorisation (SQEM-336)', () => {
  /** Every tool whose capability is `update` or `delete` — the ones that touch an existing row. */
  function mutatingNames(): string[] {
    const block = SRC.match(/const TOOL_CAPABILITY: Record<string, Capability> = \{([\s\S]*?)\n\};/);
    expect(block, 'TOOL_CAPABILITY block not found').toBeTruthy();
    return [...block![1].matchAll(/^\s{2}([a-z_]+):\s*'(update|delete)'/gm)].map(m => m[1]);
  }

  /** The body of one `if (toolName === 'x') { … }` branch, up to where the next tool begins. */
  function handlerBody(tool: string): string {
    const start = SRC.indexOf(`if (toolName === '${tool}')`);
    expect(start, `no handler found for ${tool}`).toBeGreaterThan(-1);
    const next = SRC.indexOf("if (toolName === '", start + 1);
    return code(SRC.slice(start, next === -1 ? SRC.length : next));
  }

  // The guards that answer "may this caller see it", one per object type. A new object type adds
  // its guard here — deliberately a short, explicit list rather than a loose pattern, so that
  // adding a tool without a check fails instead of accidentally matching something.
  const VISIBILITY_GUARDS = ['canAccessTemplate', 'canAccessPersona', 'accessibleFileIds'];

  /**
   * Helpers a handler may delegate its gates to (SQEM-337 introduced the first one).
   *
   * ⚠️ Delegation is allowed, but it does not excuse anything: `makes every write helper carry both
   * gates itself` below holds each helper to the same rule. Without that second test, "the handler
   * calls a function" would be enough to pass — which is how a check comes to look present and not
   * be (SQEM-332, SQEM-336).
   */
  const WRITE_HELPERS = ['findPersonaForWrite'];

  function helperBody(name: string): string {
    const start = SRC.indexOf(`const ${name} = async (`);
    expect(start, `no write helper found: ${name}`).toBeGreaterThan(-1);
    const next = SRC.indexOf("\n    if (toolName === '", start);
    return code(SRC.slice(start, next === -1 ? SRC.length : next));
  }

  /** A handler's own body, plus the body of any write helper it delegates to. */
  function effectiveBody(tool: string): string {
    const body = handlerBody(tool);
    return body + WRITE_HELPERS.filter(h => body.includes(h)).map(helperBody).join('');
  }

  it('makes every write helper carry the visibility gate itself', () => {
    // ⚠️ Authority is no longer asked here — SQEM-341 moved it to the capability dispatch, so a
    // member never reaches these helpers at all. Visibility stays per-object and therefore local.
    for (const helper of WRITE_HELPERS) {
      const body = helperBody(helper);
      expect(body, `${helper} must check visibility`).toMatch(/canAccess(Template|Persona)/);
    }
  });

  it('checks visibility in every update/delete handler', () => {
    const unguarded = mutatingNames().filter(
      tool => !VISIBILITY_GUARDS.some(guard => effectiveBody(tool).includes(guard)),
    );
    expect(
      unguarded,
      `update/delete tools with no visibility check: ${unguarded.join(', ')} — ` +
        `each handler must consult one of ${VISIBILITY_GUARDS.join(', ')}, directly or through a helper`,
    ).toEqual([]);
  });

  /**
   * SQEM-341 — a member reads the library and does not change it.
   *
   * ⛔ Enforced at the **capability dispatch**, not per handler, and that placement is the point.
   * Six tools create things; guarding each would have been six chances to forget, and the one that
   * gets forgotten is silent because a skipped check looks like success. That is precisely how
   * SQEM-336 happened. Deriving the gate from `TOOL_CAPABILITY` means a new tool is covered by
   * being *declared*, not by someone remembering.
   *
   * ⚠️ The scope check beside it is not a substitute: scopes say what the connection was issued
   * for, and a member picks their own when they mint a key (SQEM-328, default is all four). The
   * scope is theirs to grant themselves; the role is not.
   */
  it('refuses every non-read capability unless the caller may write', () => {
    expect(SRC).toMatch(/if \(requiredCap !== 'read' && !mayWrite\) \{/);
  });

  it('derives the write right from the role, and from nothing else', () => {
    // ⛔ No `createdBy` parameter (SQEM-341). Once a member cannot create, ownership could only ever
    // be inherited from an earlier role — a grandfathering clause for the demoted, invisible and
    // uncountable. RLS never granted it; this is MCP catching up, not a new rule.
    //
    // ⛔ And no `!mcpUserId` disjunct (SQEM-346). That was the workspace-wide key: the last place
    // where authority hung on a SECRET rather than on a PERSON — and it was reachable by accident,
    // because `user_id` carried `on delete set null`, so deleting a profile promoted that person's
    // read-only member key into it.
    expect(SRC).toMatch(/const mayWrite: boolean = mcpUserManagesContent;/);
    expect(SRC, 'the row-scoped predicate should be gone').not.toMatch(/hasWriteAuthority/);
    expect(SRC, 'no path may grant write without a role').not.toMatch(/!mcpUserId \|\|/);
  });

  it('derives that authority from the role, not from the scope alone', () => {
    expect(SRC).toMatch(/from\('workspace_members'\)[\s\S]{0,200}?\.eq\('user_id', mcpUserId\)/);
    expect(SRC).toContain("const mcpUserRole: string | null = (memberRow as { role?: string } | null)?.role ?? null");
  });

  it('does not advertise a write tool to a connection that may not write (SQEM-349)', () => {
    /**
     * ⛔ Reported from production: a member ticked *Create* on their own key, `create_template`
     * showed up in their client, they used it, and `tools/call` refused them. The refusal was
     * right — advertising the tool was not. A model cannot tell "you may not" from "this is
     * broken", and neither can the person watching it.
     *
     * ⚠️ SQEM-332 was the same disagreement pointing the other way: not offered, not guarded.
     * Whichever way it points, the advertisement is the silent half.
     */
    const src = code(SRC);
    const filter = src.match(/const visibleTools = tools\.filter\(([\s\S]*?)\n\s*\}\);/);
    expect(filter, 'the tools/list filter was not found — did it get rewritten?').toBeTruthy();
    // Scope alone is not enough: the role has to appear in the same predicate.
    expect(filter![1]).toContain('scopes.includes');
    expect(filter![1], 'tools/list must consult the role, not only the scope').toContain('mayWrite');
    // And `read` must survive it — a member whose tools all vanished would be worse than the bug.
    expect(filter![1], "read must not be gated behind mayWrite").toMatch(/cap === 'read' \|\| mayWrite/);
  });

  it('refuses a key that belongs to nobody (SQEM-346)', () => {
    // `user_id` is NOT NULL in the database, so this guard cannot fire. It is pinned precisely
    // BECAUSE it cannot: a null slipping through would not throw, it would silently restore the
    // workspace-wide key. A guard whose absence fails open has to be held in place by a test.
    expect(code(SRC)).toMatch(/const keyUserId: string \| null =[\s\S]{0,120}?if \(!keyUserId\) \{[\s\S]{0,60}?authChallenge\(\)/);
  });

  it('counts calls without refusing any (SQEM-351)', () => {
    const src = code(SRC);
    expect(src, 'calls are not being recorded at all').toContain("rpc('record_mcp_call'");

    // ⛔ **Recording itself must refuse nothing**, and the order matters more than it looks now that
    // SQEM-352's budget sits right after it: a call the budget turns away is still DEMAND, and it has
    // to be counted before it is refused. Counting only what got through would measure the limit
    // instead of the need — and the next calibration would then justify itself with its own effect.
    //
    // ⚠️ Bounded to the counting block itself. A looser window reaches into the routing that follows,
    // where refusals are normal and expected — and a test that fails on correct code next door gets
    // relaxed rather than read.
    const block = src.match(/if \(counted\) \{[\s\S]*?\[mcp-metrics\]/);
    expect(block, 'the counting block was not found — was it restructured?').toBeTruthy();
    expect(block![0], 'recording must not refuse or short-circuit').not.toMatch(/\breturn\b|rpcError/);
  });

  it('checks a per-key budget, read and write kept apart (SQEM-352)', () => {
    const src = code(SRC);
    expect(src).toContain("rpc('check_mcp_rate_limit'");
    // ⭐ Per KEY, not per workspace. A workspace-wide limit lets one runaway client throttle the
    // whole team — the attacker then causes exactly the damage the limit exists to prevent, to the
    // wrong people.
    expect(src).toMatch(/check_mcp_rate_limit'[\s\S]{0,160}?p_key_id: keyId/);
    // Two budgets, because an agent reads constantly and writes rarely; one shared number has to be
    // set for the loud case and is then useless for the expensive one.
    expect(src).toMatch(/MCP_READ_RPM/);
    expect(src).toMatch(/MCP_WRITE_RPM/);
    expect(src).toMatch(/kind === 'read' \? MCP_READ_RPM : MCP_WRITE_RPM/);
  });

  it('fails open when the budget check itself is broken (SQEM-352)', () => {
    // ⛔ A limiter that locks people out when IT is unhealthy is worse than what it protects against.
    // This is the same decision as the older helper — and the same trap: SQEM-335 failed open for
    // seven months without anyone noticing. Visibility is handled by the migration's self-test, not
    // by making this fail closed.
    const src = code(SRC);
    const block = src.match(/check_mcp_rate_limit'[\s\S]*?\[mcp-rate\] check threw/);
    expect(block, 'the budget block was not found — was it restructured?').toBeTruthy();
    expect(block![0], 'a broken budget check must not refuse the caller').toMatch(/budgetErr[\s\S]{0,200}?console\.error/);
    // The refusal must be reachable only on an explicit `false`, never on an error or on undefined.
    expect(block![0]).toMatch(/withinBudget === false/);
  });

  it('tells the client what ran out and when it returns (SQEM-352)', () => {
    // A refusal a model cannot act on leaves it two options: give up, or hammer. Hammering is the
    // behaviour the limit exists to stop, so a bare error would make the limit self-defeating.
    const src = code(SRC);
    expect(src).toMatch(/Rate limit reached[\s\S]{0,200}?resets within 60 seconds/);
    expect(src, 'the message should say the limit is per connection').toMatch(/per connection/);
  });

  it('does not count the handshake, and takes the capability from the map (SQEM-351)', () => {
    const src = code(SRC);
    // `initialize`/`ping` are emitted on the client's own schedule and would swamp the signal.
    //
    // ⛔ Anchored to the counting guard itself, immediately followed by `const counted`. The first
    // version of this test matched loosely and passed while the guard was weakened — because the
    // PAYWALL gate a few lines above tests the same two methods, and the loose match found that one
    // instead. Caught by mutation, not by reading. **A test that can match the wrong occurrence of a
    // condition is not testing the condition.**
    expect(src, 'the counting guard must skip the handshake').toMatch(
      /if \(method !== 'initialize' && method !== 'ping'\) \{\s*const counted/,
    );
    // ⚠️ The capability is read from TOOL_CAPABILITY, never re-derived — a second copy of that
    // mapping is what SQEM-332 and SQEM-349 each cost.
    expect(src).toMatch(/TOOL_CAPABILITY\[[\s\S]{0,80}?\][\s\S]{0,200}?record_mcp_call/);
  });

  it('stops answering after 90 days of silence (SQEM-348)', () => {
    const src = code(SRC);
    expect(src).toMatch(/IDLE_LIMIT_MS = 90 \* 24 \* 60 \* 60 \* 1000/);
    // ⚠️ The fallback matters as much as the limit: a key issued and never used has a null
    // `last_used_at`, and reading that as "unknown, let it through" would exempt exactly the
    // connections nobody is watching.
    expect(src).toMatch(/last_used_at[\s\S]{0,160}?\?\?[\s\S]{0,80}?created_at/);
    expect(src).toMatch(/Date\.now\(\) - new Date\(lastSeen\)\.getTime\(\) > IDLE_LIMIT_MS/);
  });

  it('reads freshness BEFORE stamping it', () => {
    // The handler updates `last_used_at` on every call. If the idle check ran after that write,
    // every key would look used a millisecond ago and the limit above would never bite.
    const src = code(SRC);
    expect(src.indexOf('IDLE_LIMIT_MS')).toBeGreaterThan(-1);
    expect(src.indexOf('IDLE_LIMIT_MS')).toBeLessThan(src.indexOf("update({ last_used_at:"));
  });

  it('has no visibility branch for a connection without a user (SQEM-346)', () => {
    // Both `else` branches (SQEM-210 templates, SQEM-324 personas) served the workspace-wide key.
    // With that key gone the question has one answer, and a surviving branch would be a second,
    // laxer definition of "what may this connection see".
    const src = code(SRC);
    expect(src).not.toMatch(/canAccessTemplate = \(templateId: string\) => !restricted\.has/);
    expect(src).not.toMatch(/canAccessPersona = \(personaId: string\) => !restrictedPersonas\.has/);
  });

  it('counts editors, not admins alone', () => {
    expect(SRC).toMatch(/const mcpUserManagesContent =\s*\n?\s*mcpUserRole === 'admin' \|\| mcpUserRole === 'editor'/);
  });

  it('refuses to reach past the caller\'s sight when a file is force-detached', () => {
    /**
     * SQEM-340, and since SQEM-341 it constrains exactly one caller: the workspace-wide key.
     *
     * Anyone user-bound who gets this far is already an editor or admin. A key with no user passes
     * the central gate on `!mcpUserId` — bounded by its narrow sight — and `force`/`replaceWith` is
     * the one action that would reach past that sight. ⛔ The check looks redundant and is not.
     */
    expect(handlerBody('delete_file'), 'the blast-radius check must use the role')
      .toMatch(/if \(restricted > 0 && !mcpUserManagesContent\)/);
  });

  it('keeps the write rule in one place', () => {
    // A second copy of an authority rule is how the first gap came to exist (SQEM-248 makes the
    // same point about the ownership default). One definition, one gate.
    const definitions = [...SRC.matchAll(/^\s*const mayWrite: boolean = /gm)];
    expect(definitions.length, 'mayWrite must be defined exactly once').toBe(1);
    const gates = [...SRC.matchAll(/if \(requiredCap !== 'read' && !mayWrite\)/g)];
    expect(gates.length, 'the write gate must exist exactly once').toBe(1);
});
});

/**
 * SQEM-337 — two decisions in `create_persona` that a later "consistency" edit would undo.
 *
 * Both look like omissions next to `create_template`, which seeds `default_template_access` and
 * whose sibling paths stamp provenance. They are not omissions; they were chosen, and the reasons
 * live in the ticket and in the code comments. Pinned here so that undoing them is a failing test
 * rather than a tidy-up nobody questions.
 */
describe('MCP persona creation defaults (SQEM-337)', () => {
  function createBody(): string {
    const start = SRC.indexOf("if (toolName === 'create_persona')");
    expect(start, 'create_persona handler not found').toBeGreaterThan(-1);
    const next = SRC.indexOf("if (toolName === '", start + 1);
    return code(SRC.slice(start, next === -1 ? SRC.length : next));
  }

  it('creates a persona open, seeding no access row', () => {
    // A persona hands out no access of its own: SQEM-326 filters every route against the caller and
    // hides a persona whose routes are all out of reach. Restricting it would buy nothing and cost
    // the case that made 47 of 82 templates unreachable (SQEM-240).
    expect(createBody()).not.toMatch(/from\('persona_access'\)/);
  });

  it('stamps no AI provenance', () => {
    // Article 50 classification: MCP is "neither — the client labels". The generating model runs in
    // the client, under the client's name. `create_template` has never stamped it here either.
    expect(createBody()).not.toMatch(/ai_generated_at:/);
  });

  it('still records who created it', () => {
    // ⚠️ Not the same question. No owner is correct only for a key with no user; for a user-bound
    // connection a missing `created_by` is what breaks "Only me" irrecoverably (SQEM-240).
    expect(createBody()).toMatch(/created_by:\s+mcpUserId/);
  });
});

/**
 * SQEM-338 — the route tools, and the one thing that makes `attach_template` honest.
 *
 * SQEM-326 decided that attaching must not widen access: routes are filtered against the CALLER,
 * never the author. That is right, and it has a consequence — attaching a restricted template
 * produces a persona that is quietly smaller for everyone else, their routes simply absent. For
 * humans that ticket solved it by naming the restricted attachments to the author in the editor.
 *
 * ⛔ Over MCP there is no editor to warn in. The warning has to ride in the tool's reply, or the
 * invisibility SQEM-326 spent its whole effort on comes back through a new door. That is why the
 * reach report is an acceptance condition of the ticket and is pinned here.
 */
describe('MCP persona routes (SQEM-338)', () => {
  function body(tool: string): string {
    const start = SRC.indexOf(`if (toolName === '${tool}')`);
    expect(start, `${tool} handler not found`).toBeGreaterThan(-1);
    const next = SRC.indexOf("if (toolName === '", start + 1);
    return code(SRC.slice(start, next === -1 ? SRC.length : next));
  }

  it('refuses an attach without a condition', () => {
    // `persona_templates.condition` has `default ''`, and an empty one renders as the template's own
    // description — technically valid, and exactly the route that says nothing about what the
    // template means IN THIS persona. Required in the schema and checked in the handler.
    expect(body('attach_template')).toMatch(/if \(!condition\?\.trim\(\)\)/);
    const decl = SRC.slice(SRC.indexOf("name: 'attach_template'"), SRC.indexOf("name: 'detach_template'"));
    expect(decl).toMatch(/required: \['persona_id', 'template_id', 'condition'\]/);
  });

  it('reports what a restricted attachment means for everyone else', () => {
    const attach = body('attach_template');
    // Reads the access rules…
    expect(attach).toMatch(/from\('template_access'\)/);
    // …and says so in the reply rather than swallowing it.
    expect(attach).toContain('reach:');
    expect(attach).toContain('RESTRICTED');
  });

  it('requires the template to be visible before it can be named in a route', () => {
    expect(body('attach_template')).toContain('canAccessTemplate');
  });

  it('does NOT require template visibility to detach', () => {
    // ⛔ Deliberate asymmetry, and the reason is the same one that kept `hiddenFromCaller` out of
    // the write path (SQEM-337): requiring it would strand a persona's owner with a route they
    // cannot remove, the moment somebody restricts the template behind it. The person who has to
    // clean it up is exactly the one the rule would lock out.
    expect(body('detach_template')).not.toContain('canAccessTemplate');
    // The persona's own gates still apply, through the shared helper.
    expect(body('detach_template')).toContain('findPersonaForWrite');
  });
});
