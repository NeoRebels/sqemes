/**
 * SQEM-561 — every library tool, once, for both surfaces that offer them: the MCP server and sqemes Chat.
 *
 * ⭐ **Moved, not copied — the code below is what `mcp-server/index.ts` ran until SQEM-561, line for
 * line.** Chat gained the write tools — every tool, bounded by access and "Who can edit" — and a second
 * implementation of
 * "who may change this playbook" would be the twin SQEM-373 refused to build for reading. A rule fixed
 * on one surface and left standing on the other is a security bug that reads like a feature gap.
 *
 * ⚠️ **Why the handlers still say `rpcResult(id, …)`, `rpcError(id, …)` and `mcpUserId`.** Keeping the
 * moved text identical makes the move reviewable as a move (`git diff --color-moved`) and keeps every
 * test that pins a handler's shape pointing at the same words. Here the two helpers build an OUTCOME,
 * not a response; each surface wraps it in its own envelope (JSON-RPC in `mcp-server`, a tool-result
 * string in `_shared/libraryTools.ts`). `id` is always null inside this module, and `mcpUserId` is
 * simply the person the call runs as — the MCP key's owner or the chat user, never a key.
 *
 * Pure of `Deno.serve`: importable by both functions. Not importable by vitest (npm: specifiers), so the
 * tests read it as text, like the server.
 */
import JSZip from 'npm:jszip@3.10.1';
import { createAdminClient } from './supabase-admin.ts';
import {
  type LibraryReader, toSlug, LibraryNotFound, LibraryBadRequest, isPathInWorkspace,
} from './libraryQueries.ts';
import { countUsage } from './usageCounts.ts';
import { safeStorageFileName } from './storageKey.ts';
import { classifySkillFile, extensionOf, sniffBinaryMime, TEXT_EXT_TO_MIME, STORAGE_TEXT_MIME, OCTET_STREAM, SKILL_STORAGE_MIMES } from './skillFile.ts';
import { readSkillMd, toSlug as skillSlug, withoutOwnFrontmatter, buildSkillMd } from './skillMd.ts';
import { relativeSkillPaths, uploadedFileName } from './skillPaths.ts';
import { isTextContentMime, deliveryOf } from './skillFile.ts';
import { onPublicHost, dailyLimitMessage, MAX_PATHS_PER_CALL } from './fileLinks.ts';
import {
  findSkillRoot,
  isArchiveJunk,
  downloadArchive,
  resolveArchiveUrl,
  SKILL_ENTRY,
} from './skillArchive.ts';
import { TOOL_CAPABILITY } from './libraryToolDefs.ts';

// SQEM-561 — the definitions and the capability map are import-free (`./libraryToolDefs.ts`), so
// tests and Chat's adapter can read them; re-exported so the server keeps one import.
export { type Capability, TOOL_CAPABILITY, LIBRARY_TOOL_DEFS } from './libraryToolDefs.ts';

// ---- The outcome both surfaces wrap ----

/** What a tool call produced: MCP's `result` (`{ content: [...] }`), or a JSON-RPC-coded refusal. */
export type LibraryToolOutcome =
  | { ok: true; result: { content: unknown[] } }
  | { ok: false; code: number; message: string };

function rpcResult(_id: unknown, result: { content: unknown[] }): LibraryToolOutcome {
  return { ok: true, result };
}

function rpcError(_id: unknown, code: number, message: string): LibraryToolOutcome {
  return { ok: false, code, message };
}

/**
 * SQEM-373 — the JSON-RPC envelope around a shared library read.
 *
 * ⭐ This is the whole seam. `_shared/libraryQueries.ts` returns plain data and knows nothing about
 * JSON-RPC; Chat wraps the same data as a tool result. Putting either envelope in the query module
 * would have forced the other surface to unwrap it again.
 */
export async function libraryResult(id: unknown, run: () => Promise<unknown>): Promise<LibraryToolOutcome> {
  try {
    const result = await run();
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    return libraryError(id, err);
  }
}

/**
 * ⚠️ Both library errors map to -32602 (invalid params), which is what these handlers returned
 * before the move. Anything else is a real fault and is re-thrown to the outer handler rather than
 * flattened into "not found" — a database outage that reads as a missing template is the kind of
 * error somebody spends an afternoon on.
 */
export function libraryError(id: unknown, err: unknown): LibraryToolOutcome {
  if (err instanceof LibraryNotFound || err instanceof LibraryBadRequest) {
    return rpcError(id, -32602, err.message);
  }
  throw err;
}

// ---- Download links (SQEM-514) ----
//
// A file an agent should USE rather than read — `scripts/`, `assets/`, every binary — comes back as a
// signed link, so it can be saved and run where the agent works (Claude Code, Codex, a sandbox).
// 15 minutes: long enough for a turn, short enough that a leaked link is close to worthless; one file
// per link. Served as a download (`download` → Content-Disposition: attachment), on the public host.
// ⚠️ Storage sends NO nosniff (measured 2026-10-17); the attachment header and the stored types
// (never HTML/SVG — an .svg is text/plain) are what keep a file from being rendered. On Cloud every link counts against the workspace's daily download
// ceiling exactly like `sign-file-url` (SQEM-515); self-host does not count.
const LINK_EXPIRY_SECONDS = 900;
const SELF_HOSTED = Deno.env.get('SELF_HOSTED') === 'true';

class DownloadLimitReached extends Error {}

async function issueDownloadLinks(
  adminClient: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const publicBase = Deno.env.get('PUBLIC_API_URL') ?? null;
  for (let i = 0; i < paths.length; i += MAX_PATHS_PER_CALL) {
    const page = paths.slice(i, i + MAX_PATHS_PER_CALL);
    if (!SELF_HOSTED) {
      const { data: rec, error } = await adminClient.rpc('record_file_download', { p_ws: workspaceId, p_paths: page });
      // Fail open, as in sign-file-url: a broken counter must not lock anybody out of their files.
      if (error) console.error('[mcp] download counting failed, signing anyway:', error.message);
      else if (rec && rec.allowed === false) throw new DownloadLimitReached(dailyLimitMessage(Number(rec.used_today), Number(rec.day_limit)));
    }
    const { data: signed, error: signErr } = await adminClient.storage
      .from('workspace-files').createSignedUrls(page, LINK_EXPIRY_SECONDS, { download: true });
    if (signErr) throw new Error(`Could not create download links: ${signErr.message}`);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) out.set(s.path, onPublicHost(s.signedUrl, publicBase));
  }
  return out;
}

/**
 * SQEM-341 — the one refusal a member gets for any write, on either surface, so nobody has to guess
 * which tool is the fussy one.
 */
export function writeRefusalMessage(what: string): string {
  return `Not allowed: ${what}. Creating, changing and deleting are for editors and admins; a member's connection is read-only. This matches the web app, where the same actions are closed to members.`;
}

// ---- What a file IS (SQEM-514) ----
//
// One rule for every path in and out, shared with the browser: `_shared/skillFile.ts`. Text is decided
// by the bytes (valid UTF-8, no NUL), not by an extension list — until SQEM-514 there were five such
// lists, and the one here (`TEXT_MIME`) silently dropped every .drawio, .ttf, .xsd and .docx in a
// skill. Storage only ever receives the types in `SKILL_STORAGE_MIMES` (the bucket allowlist,
// pinned by `tests/unit/skillImport.test.ts`); the row carries the type every reader decides by.

// Caps for the fetched archive. The download cap is the cheap one — it refuses before anything is
// unpacked; the uncompressed cap is the zip-bomb guard, and the file cap keeps one call from filling
// a workspace. `diagram-design`, the skill this was built against, is 152 files and 2 MB.
const SKILL_MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const SKILL_MAX_FILES = 500;
// How many storage uploads run at once. Sequential is too slow for 150 files inside one request;
// unbounded parallelism is how you get rate-limited by your own storage API.
const SKILL_UPLOAD_CONCURRENCY = 8;

/**
 * SQEM-240 — does this workspace start new templates restricted?
 *
 * The owner (`created_by`) and this default were both missing on the MCP write path, and it was the
 * only write path in the product that skipped them: the marketplace copy and the browser editor have
 * always set `created_by`, and the browser applies `default_template_access` via
 * `seedFromWorkspaceDefault`. There is no trigger on `prompts` doing either.
 *
 * ⚠️ `created_by = NULL` is not cosmetic. `can_access_template` compares `created_by` to the caller,
 * and `NULL = <uid>` is NULL — never true. Choosing "Only me" on such a template then writes the
 * principal-less row, which suspends the admin/editor branch (SQEM-212), and the template becomes
 * invisible to EVERYONE including its owner, recoverable only by SQL. Measured on production
 * 2026-08-17: 47 of 82 templates had no owner, 24 of 29 skills.
 *
 * ⛔ **The "without an authorizing user" case is gone (SQEM-346).** It used to matter a great deal:
 * a workspace API key had no "me", so it created "everyone" templates only — seeding a restriction
 * for a caller with no identity would have manufactured exactly the unreachable row described above.
 * Every key is a person's now, so there is always an owner to write and always a "me" to restrict to.
 *
 * SQEM-248 — shared by `create_template` and `import_skill_from_url` rather than copied. A second
 * copy of this rule is how the first one came to be missing.
 */
async function workspaceRestrictsNewTemplates(
  adminClient: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  mcpUserId: string,
): Promise<boolean> {
  const { data: ws } = await adminClient
    .from('workspaces')
    .select('default_template_access')
    .eq('id', workspaceId)
    .single();
  const dflt = (ws as { default_template_access?: string[] | null } | null)?.default_template_access;
  // SQEM-211 — this column is a two-state marker, not a grantee list. Non-empty means "new templates
  // start restricted"; reading its roles as who-may-see-it is wrong.
  return Array.isArray(dflt) && dflt.length > 0;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order in the result. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  });
  await Promise.all(workers);
  return out;
}

// Extracts {{placeholder}} names from content and builds a variables array.
// Only used for kind=prompt — skills do not support variables.
function extractVariables(content: string): any[] {
  const seen = new Set<string>();
  const regex = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) seen.add(m[1]);
  return Array.from(seen).map(name => ({
    id: crypto.randomUUID(),
    name,
    label: name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    type: 'text',
  }));
}

// Normalises the variables param accepted by create/update tools.
// Accepts [{name, label?, type?}] — label and type are optional.
function normaliseVariables(raw: any[]): any[] {
  return raw.map((v: any) => ({
    id:    v.id    ?? crypto.randomUUID(),
    name:  v.name,
    label: v.label ?? v.name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    type:  v.type  ?? 'text',
  }));
}


// ---- The handlers ----

export interface LibraryToolContext {
  adminClient: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  /** The person the call runs as: the MCP key's owner, or the chat user. Never a key. */
  userId: string;
  /** Their role in the workspace; null means "no longer a member" and fails closed. */
  role: string | null;
  lib: LibraryReader;
  /** Which surface counts a loaded playbook (SQEM-517). */
  surface: 'mcp' | 'chat';
}

/**
 * Run one library tool as `ctx.userId`. Throws only for a real fault (a database outage must not read
 * as "not found" — see `libraryError`); every refusal comes back as an outcome.
 */
export async function runLibraryTool(
  ctx: LibraryToolContext,
  toolName: string,
  args: any,
): Promise<LibraryToolOutcome> {
  const id = null;
  const { adminClient, workspaceId, lib } = ctx;
  const mcpUserId = ctx.userId;
  const canAccessTemplate = lib.canAccessTemplate;
  const canAccessPersona  = lib.canAccessPersona;
  // SQEM-339 — admin and editor manage content; a member uses it. A null role is not a member.
  const mcpUserManagesContent = ctx.role === 'admin' || ctx.role === 'editor';

  /**
   * SQEM-561 — the role gate, here as well as at the MCP dispatch.
   *
   * ⚠️ On MCP this cannot fire: `tools/call` refuses an unknown tool and a member's write before it
   * calls in here, with the scope message only MCP has. It is here for Chat, which has no dispatch of
   * its own — and so that a third surface cannot reach a write handler without passing it.
   */
  const requiredCap = TOOL_CAPABILITY[toolName];
  if (!requiredCap) return rpcError(id, -32601, `Unknown tool: '${toolName}'.`);
  if (requiredCap !== 'read' && !mcpUserManagesContent) {
    return rpcError(id, -32602, writeRefusalMessage(`'${toolName}' (${requiredCap})`));
  }

  /**
   * SQEM-473 — may this connection's person CHANGE this playbook / persona? Asked of the database, so
   * the server and the app (RLS: `can_edit_template` / `can_edit_persona`) run ONE rule: an admin
   * always, an editor unless the object names its editors and they are not among them (owner and
   * groups count). Sight is checked before this, by the existing gates; this only narrows writing.
   * Fails closed: an RPC error counts as "no".
   */
  const mayEdit = async (kind: 'template' | 'persona', objectId: string): Promise<boolean> => {
    const fn = kind === 'template' ? 'template_edit_allowed' : 'persona_edit_allowed';
    const arg = kind === 'template' ? { p_template_id: objectId, p_user_id: mcpUserId } : { p_persona_id: objectId, p_user_id: mcpUserId };
    const { data, error } = await adminClient.rpc(fn, arg);
    if (error) console.error(`[mcp] SQEM-473 ${fn} failed, refusing the write:`, error.message);
    return !error && data === true;
  };
  const refuseEdit = (id: unknown, what: 'playbook' | 'persona', title?: string | null) =>
    rpcError(id as never, -32602,
      `You may use this ${what}${title ? ` ("${title}")` : ''} but not change it: editing it is restricted to named people. Ask its owner or a workspace admin.`);

  // SQEM-324 — the tool half of personas. The prompt half (prompts/list) is what a person picks
  // from a client menu; this is what answers "use the Sales persona from Sqemes" typed as a
  // sentence, which is how it is actually used in Claude Code.
  if (toolName === 'list_personas') {
    return libraryResult(id, () => lib.listPersonas());
  }

  if (toolName === 'get_persona') {
    try {
      const { text } = await lib.getPersona({ id: args.id, name: args.name });
      // ⚠️ Markdown, not JSON — unlike every other tool here. A persona is written to be read.
      return rpcResult(id, { content: [{ type: 'text', text }] });
    } catch (err) {
      return libraryError(id, err);
    }
  }

  // ---- SQEM-337 — the write half of personas -------------------------------------------------

  type PersonaWriteTarget =
    | { ok: true;  row: { id: string; title: string; created_by: string | null } }
    | { ok: false; message: string };

  /**
   * Resolve a persona for a WRITE, applying both SQEM-336 gates in the order that ticket fixed.
   *
   * ⛔ Deliberately does NOT apply `hiddenFromCaller`, which `get_persona` does. That filter hides
   * a persona whose every route is out of the caller's reach, because a role a model cannot
   * actually perform is worse than no role at all. It is a **usefulness** rule, not an access
   * rule — and borrowing it here would make a persona uneditable by its own author the moment
   * somebody restricted the templates behind it. The author is precisely the person who then
   * needs to fix it.
   */
  const findPersonaForWrite = async (personaId: string): Promise<PersonaWriteTarget> => {
    const { data: row } = await adminClient
      .from('personas')
      .select('id, title, created_by')
      .eq('workspace_id', workspaceId)
      .eq('id', personaId)
      .single();

    // Gate 1 — visibility. Same wording for absent and invisible, or the tool becomes a way to
    // probe which ids exist (SQEM-291, applied to templates in SQEM-336).
    if (!row || !canAccessPersona(personaId))
      return { ok: false, message: `Persona not found: ${personaId}` };

    // SQEM-473 — seen is not editable. The message admits the persona exists: gate 1 passed.
    if (!(await mayEdit('persona', personaId)))
      return { ok: false, message: `You may use this persona ("${(row as { title: string }).title}") but not change it: editing it is restricted to named people. Ask its owner or a workspace admin.` };

    // Gate 2 — authority, and its message says so plainly: gate 1 is already passed, so the
    // caller knows the persona exists. Hiding behind "not found" here would explain nothing.
    //
    // ⚠️ No authority check here any more (SQEM-341). It lives once, at the capability dispatch,
    // so a member never reaches this function at all. Repeating it would be a check that cannot
    // fire — and a check that cannot fire is indistinguishable from one that does not work.
    return { ok: true, row: row as { id: string; title: string; created_by: string | null } };
  };

  if (toolName === 'create_persona') {
    const { title, description, content, tags } = args;
    if (!title?.trim()) return rpcError(id, -32602, 'title is required');

    const { data: inserted, error: insertErr } = await adminClient
      .from('personas')
      .insert({
        workspace_id: workspaceId,
        title:        title.trim(),
        description:  description?.trim() || '',
        content:      content || '',
        tags:         Array.isArray(tags) ? tags : [],
        // SQEM-240's rule, applied to personas verbatim. Since SQEM-346 there is always an owner
        // to write here — the ownerless case the rule was built for cannot arise from MCP any more.
        // ⚠️ It still matters, because `created_by` remains nullable in the table and a row CAN
        // lose its owner elsewhere: a principal-less access row over a `created_by = NULL` object
        // is invisible to EVERYONE, its author included, and recoverable only by SQL. That is what
        // made 47 of 82 templates unreachable before SQEM-240. Never seed a restriction without an
        // owner.
        created_by:   mcpUserId,
      })
      .select('id, title')
      .single();

    if (insertErr || !inserted)
      return rpcError(id, -32603, `Failed to create persona: ${insertErr?.message ?? 'unknown error'}`);

    // ⛔ No `persona_access` row is written, and that is a decision (owner, 2026-09-08), not an
    // omission: a persona starts open. Templates seed `workspaces.default_template_access` at
    // this point; personas have no equivalent and are not getting one, because a persona hands
    // out no access of its own — SQEM-326 filters every route against the CALLER, and hides a
    // persona whose routes are all out of reach. An open persona over restricted templates is
    // therefore not a leak; for anyone who may not use it, it is simply not there.
    //
    // ⛔ No `ai_generated_at` either. Our Article 50 classification puts MCP under *"neither — the
    // client labels"*: the generating model runs in the client, under the client's name, so we are
    // not the provider of that generation. The rule itself is the sentence above, so nothing is
    // missing without the source; written out in
    // `pm/DOCUMENTATION.md` in the source repository.
    // `create_template` has never stamped it here, for the same reason.
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id:    inserted.id,
      title: inserted.title,
      note:  'Created, and visible to the whole workspace. It has no routes yet — attach templates to it in the app.',
    }, null, 2) }] });
  }

  if (toolName === 'update_persona') {
    const { id: personaId, title, description, content, tags } = args;
    if (!personaId) return rpcError(id, -32602, 'id is required');

    const target = await findPersonaForWrite(personaId);
    if (!target.ok) return rpcError(id, -32602, target.message);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title       !== undefined) updates.title       = String(title).trim();
    if (description !== undefined) updates.description = String(description).trim();
    if (content     !== undefined) updates.content     = content;
    if (Array.isArray(tags))       updates.tags        = tags;

    const { error: updateErr } = await adminClient
      .from('personas')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', personaId);

    if (updateErr) return rpcError(id, -32603, `Failed to update persona: ${updateErr.message}`);

    // Naming the fields back is not decoration: this tool overwrites rather than merges, and a
    // model that passed `content` by mistake should be able to see that it did.
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      updated: true,
      id:      target.row.id,
      fields:  Object.keys(updates).filter(k => k !== 'updated_at'),
    }, null, 2) }] });
  }

  if (toolName === 'delete_persona') {
    const personaId = args.id;
    if (!personaId) return rpcError(id, -32602, 'id is required');

    const target = await findPersonaForWrite(personaId);
    if (!target.ok) return rpcError(id, -32602, target.message);

    const { error: deleteErr } = await adminClient
      .from('personas')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', personaId);

    if (deleteErr) return rpcError(id, -32603, `Failed to delete persona: ${deleteErr.message}`);

    // `persona_templates` and `persona_access` go with it by cascade. ⚠️ The TEMPLATES do not —
    // that cascade sits on the join table, so deleting a role never destroys the work it pointed
    // at. Said out loud in the reply because a model that just deleted something should be able
    // to tell the user exactly how far the deletion reached, without guessing.
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      deleted: true,
      id:      target.row.id,
      title:   target.row.title,
      note:    'The persona and its routes are gone. The templates it pointed at are untouched.',
    }, null, 2) }] });
  }

  if (toolName === 'attach_template') {
    const { persona_id, template_id, condition, sort_order } = args;
    if (!persona_id)  return rpcError(id, -32602, 'persona_id is required');
    if (!template_id) return rpcError(id, -32602, 'template_id is required');
    // ⛔ Required, not defaulted. `persona_templates.condition` has `default ''` and an empty one
    // renders as the template's own description (SQEM-324) — technically valid, and exactly the
    // route that says nothing about what this template means *in this persona*. A tool that
    // accepts the empty case invites it; the schema and this check both refuse.
    if (!condition?.trim())
      return rpcError(id, -32602, 'condition is required — say when this route applies, in the persona\'s own terms. It is what a route is for.');

    const target = await findPersonaForWrite(persona_id);
    if (!target.ok) return rpcError(id, -32602, target.message);

    // The template must be visible too: attaching means naming it, and you cannot name what you
    // are not allowed to see. Same wording as an absent row, for the SQEM-291 reason.
    const { data: tpl } = await adminClient
      .from('prompts')
      .select('id, title')
      .eq('workspace_id', workspaceId)
      .eq('id', template_id)
      .single();
    if (!tpl || !canAccessTemplate(template_id))
      return rpcError(id, -32602, `Template not found: ${template_id}`);

    let order = typeof sort_order === 'number' ? sort_order : null;
    if (order === null) {
      const { data: last } = await adminClient
        .from('persona_templates')
        .select('sort_order')
        .eq('persona_id', persona_id)
        .order('sort_order', { ascending: false })
        .limit(1);
      order = (((last as { sort_order: number }[] | null) || [])[0]?.sort_order ?? -1) + 1;
    }

    const { error: attachErr } = await adminClient
      .from('persona_templates')
      .upsert(
        { persona_id, template_id, condition: condition.trim(), sort_order: order },
        { onConflict: 'persona_id,template_id' },
      );
    if (attachErr) return rpcError(id, -32603, `Failed to attach template: ${attachErr.message}`);

    // ⛔ SQEM-338's acceptance condition, not a nicety.
    //
    // SQEM-326 decided that attaching must NOT widen access — routes are filtered against the
    // CALLER, never the author. Correct, and it has a consequence: attaching a restricted
    // template produces a persona that is quietly smaller for everyone else, their routes simply
    // absent. For humans that ticket solved it by naming the restricted attachments to the author
    // in the editor. ⚠️ Over MCP there is no editor to warn in — so the warning has to travel in
    // the reply, or the invisibility SQEM-326 spent its effort on returns through a new door.
    const { data: rules } = await adminClient
      .from('template_access')
      .select('template_id')
      .eq('workspace_id', workspaceId)
      .eq('template_id', template_id);
    const restricted = (((rules as unknown[] | null) || []).length) > 0;

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      attached:    true,
      persona:     target.row.title,
      template:    (tpl as { title: string }).title,
      condition:   condition.trim(),
      sort_order:  order,
      reach: restricted
        ? 'RESTRICTED — this template has access rules. Colleagues those rules exclude receive the persona WITHOUT this route, and nothing tells them why. Attaching granted nobody access. Say this to whoever asked for the attachment.'
        : 'Open to the whole workspace — everyone who uses this persona gets this route.',
    }, null, 2) }] });
  }

  if (toolName === 'detach_template') {
    const { persona_id, template_id } = args;
    if (!persona_id)  return rpcError(id, -32602, 'persona_id is required');
    if (!template_id) return rpcError(id, -32602, 'template_id is required');

    const target = await findPersonaForWrite(persona_id);
    if (!target.ok) return rpcError(id, -32602, target.message);

    // ⚠️ Deliberately NO visibility check on the template here, unlike attach.
    //
    // Attaching means naming a template, so you must be allowed to see it. Detaching removes
    // something from a persona that is already yours to change — and requiring template
    // visibility would strand its owner with a route they cannot remove the moment somebody
    // restricts the template behind it. Same trap as reusing `hiddenFromCaller` for writes: the
    // person who has to clean it up is the one the rule would lock out.
    const { data: removed, error: detachErr } = await adminClient
      .from('persona_templates')
      .delete()
      .eq('persona_id', persona_id)
      .eq('template_id', template_id)
      .select('template_id');

    if (detachErr) return rpcError(id, -32603, `Failed to detach template: ${detachErr.message}`);
    if (!removed || (removed as unknown[]).length === 0)
      return rpcError(id, -32602, `That template is not attached to this persona: ${template_id}`);

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      detached: true,
      persona:  target.row.title,
      note:     'The route is gone. The template itself is untouched and still available on its own.',
    }, null, 2) }] });
  }

  if (toolName === 'list_templates') {
    return libraryResult(id, () => lib.listTemplates({ kind: args.kind && args.kind !== 'all' ? args.kind : null }));
  }

  if (toolName === 'search_templates') {
    return libraryResult(id, () => lib.searchTemplates({ query: args.query || '', kind: args.kind ?? null }));
  }

  if (toolName === 'get_template') {
    // SQEM-499 — `list` by default on MCP too (it was `inline` since SQEM-230). The Agent Skills
    // standard loads a skill's files on demand; inlining every file cost a typical skill ~35,000
    // tokens per call and a 154-file one 16–40 s. It became possible only now that MCP has a TOOL
    // to read a file (read_context_file below): `resources/read` is not something a model can call
    // in most clients, so `list` without it would have cut the model off from the files.
    // `inline` stays available on request; going back is this one default.
    return libraryResult(id, () => lib.getTemplate({
      id: args.id, name: args.name, includeFiles: args.include_files ?? 'auto', // skill → list, prompt → inline
    }).then(t => {
      // SQEM-517 — counted per workspace and day, never per person; after the answer, never in its way.
      countUsage(adminClient, workspaceId, ctx.surface, 'playbook_loaded', t.id);
      return t;
    }));
  }

  if (toolName === 'read_context_file') {
    // SQEM-499 — one file, on demand: by the uri from get_template, or by its path inside the
    // playbook (`references/x.md`), the way SKILL.md refers to it. Same reader as `resources/read`.
    // SQEM-514 — delivered by PURPOSE: a file to read (text outside assets/ and scripts/) as text, a
    // file to use (scripts/, assets/, every binary) as a download link; `as` asks for the other.
    try {
      const fileId = args.uri
        ? String(args.uri)
        : await lib.contextFileIdByPath({
            ...(/^[0-9a-f-]{36}$/i.test(String(args.template ?? '')) ? { id: String(args.template) } : { name: args.template }),
            path: String(args.path ?? ''),
          });
      const meta = await lib.contextFileMeta(fileId);
      const isText = isTextContentMime(meta.mimeType);
      const delivery = deliveryOf(meta.name, meta.mimeType, args.as);
      if (delivery === 'refuse') {
        return rpcError(id, -32602, `"${meta.name}" is a binary file (${meta.mimeType}) — it has no text. Ask with as: "file" for a download link.`);
      }
      if (delivery === 'text') {
        const file = await lib.readContextFile(meta.id);
        return rpcResult(id, { content: [{ type: 'text', text: file.text ?? '' }] });
      }
      const url = (await issueDownloadLinks(adminClient, workspaceId, [meta.storagePath])).get(meta.storagePath);
      if (!url) return rpcError(id, -32603, 'Could not create a download link for this file');
      const content: unknown[] = [{ type: 'text', text: JSON.stringify({
        name: meta.name,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        url,
        expiresInSeconds: LINK_EXPIRY_SECONDS,
        howTo: 'GET the url (no auth header) and save the bytes under the file\'s path. One file per link, valid 15 minutes.'
          + (isText ? ' Ask again with as: "text" to read it instead.' : ''),
      }, null, 2) }];
      // An image is also shown, so a model that cannot fetch still sees it (≤ 5 MB).
      if (meta.mimeType.startsWith('image/') && meta.sizeBytes <= 5 * 1024 * 1024) {
        const file = await lib.readContextFile(meta.id);
        if (file.base64) content.push({ type: 'image', data: file.base64, mimeType: meta.mimeType });
      }
      return rpcResult(id, { content });
    } catch (err) {
      if (err instanceof DownloadLimitReached) return rpcError(id, -32603, err.message);
      return libraryError(id, err);
    }
  }

  if (toolName === 'download_skill') {
    // SQEM-514 — a skill as the folder it is, for agents that install skills (Claude Code, Codex):
    // SKILL.md as text, every other file as path + size + link. Nothing passes through the model but
    // the SKILL.md and the list — the same reason import_skill_from_url fetches archives itself.
    try {
      const sk = await lib.skillFolder({
        ...(/^[0-9a-f-]{36}$/i.test(String(args.template ?? '')) ? { id: String(args.template) } : { name: args.template }),
      });
      const slug = skillSlug(sk.title);
      const paths = relativeSkillPaths(sk.files.map(f => f.name), slug);
      const links = sk.files.length ? await issueDownloadLinks(adminClient, workspaceId, sk.files.map(f => f.storagePath)) : new Map();
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        skill: slug,
        install: `Create the folder "${slug}/" in your skills directory (Claude Code: ~/.claude/skills/${slug}/), write SKILL.md there, then GET each url and save it under its path. Links are valid 15 minutes.`,
        skillMd: buildSkillMd({ title: sk.title, description: sk.description, content: sk.content }),
        files: sk.files.map((f, i) => ({ path: paths[i], sizeBytes: f.sizeBytes, mimeType: f.mimeType, url: links.get(f.storagePath) ?? null })),
        expiresInSeconds: LINK_EXPIRY_SECONDS,
      }, null, 2) }] });
    } catch (err) {
      if (err instanceof DownloadLimitReached) return rpcError(id, -32603, err.message);
      return libraryError(id, err);
    }
  }

  if (toolName === 'list_files') {
    const { data: files } = await adminClient
      .from('workspace_files')
      .select('id, name, mime_type')
      .eq('workspace_id', workspaceId)
      .order('name');

    // SQEM-291 — the third way out, and the one easiest to miss: `resources/list` and
    // `resources/read` are the MCP resource surface, but `list_files` is a *tool* and reaches the
    // same rows by a different route. Closing two of three leaves the door open while the diff
    // looks complete.
    const result = (files || []).filter((f: any) => lib.canAccessFile(f.id)).map((f: any) => ({
      id:       f.id,
      name:     f.name,
      mimeType: f.mime_type,
    }));

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  }

  if (toolName === 'create_template') {
    const { kind, title, content, description, variables, file_ids } = args;

    // SQEM-390 — `assistant` is refused with a pointer, not silently mapped: a client that still
    // asks for one is running on an old idea of the product, and the honest answer names the new one.
    if (kind === 'assistant')
      return rpcError(id, -32602, 'kind "assistant" no longer exists: create a skill for knowledge, or a persona (create_persona) for a role');
    if (!kind || !['prompt', 'skill'].includes(kind))
      return rpcError(id, -32602, 'kind must be one of: prompt, skill');
    if (!title?.trim())   return rpcError(id, -32602, 'title is required');
    if (content == null)  return rpcError(id, -32602, 'content is required');
    if (kind === 'skill' && !description?.trim())
      return rpcError(id, -32602, 'description is required for kind=skill — AI agents need it to discover the skill');

    // Resolve variables: explicit param takes precedence, then auto-extract from content
    let resolvedVars: any[] = [];
    if (kind === 'prompt') {
      if (Array.isArray(variables) && variables.length > 0) {
        resolvedVars = normaliseVariables(variables);
      } else {
        resolvedVars = extractVariables(content || '');
      }
    }

    // SQEM-240 — the owner (`created_by` below) and the workspace's default access. See
    // `workspaceRestrictsNewTemplates` for why both matter and what breaks without them.
    const restrictByDefault = await workspaceRestrictsNewTemplates(adminClient, workspaceId, mcpUserId);

    // SQEM-249 — a skill's body keeps only the frontmatter keys that are not ours. A model that
    // read a SKILL.md and passed the whole file lands here, header and all; storing it verbatim is
    // how the double-frontmatter export came about, and it also leaves a `title:` in the body that
    // contradicts the column the moment someone renames the skill. The author's own keys
    // (`license`, `metadata`, …) stay — they have nowhere else to live.
    const storedContent = kind === 'skill' ? withoutOwnFrontmatter(content || '') : (content || '');

    const { data: inserted, error: insertErr } = await adminClient
      .from('prompts')
      .insert({
        workspace_id:       workspaceId,
        kind,
        title:              title.trim(),
        content:            storedContent,
        description:        description?.trim() || '',
        variables:          resolvedVars,
        context_file_ids:   Array.isArray(file_ids) ? file_ids : [],
        created_by:         mcpUserId,
        updated_by:         mcpUserId, // SQEM-477 — the author of version 1; auth.uid() is empty here
      })
      .select('id, title, kind')
      .single();

    if (insertErr || !inserted)
      return rpcError(id, -32603, `Failed to create template: ${insertErr?.message ?? 'unknown error'}`);

    if (restrictByDefault) {
      // The principal-less row: a restriction exists and nobody is named by it (SQEM-210), which
      // with `created_by` set above means the creator alone. Non-fatal on purpose — a template
      // that exists and is open is recoverable; failing the whole call after the row is already
      // inserted would leave the caller believing nothing happened.
      const { error: accessErr } = await adminClient
        .from('template_access')
        .insert({ template_id: inserted.id, workspace_id: workspaceId });
      if (accessErr) console.error('[mcp] SQEM-240 default access not applied', inserted.id, accessErr.message);
    }

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id:            inserted.id,
      name:          toSlug(inserted.title),
      title:         inserted.title,
      kind:          inserted.kind,
      argumentCount: resolvedVars.length,
      variables:     resolvedVars.map((v: any) => v.name),
      fileCount:     Array.isArray(file_ids) ? file_ids.length : 0,
      // SQEM-240 — report it rather than leave the caller guessing. Who can see a template the
      // agent just created is exactly the kind of thing a person wants told, not discovered.
      visibility:    restrictByDefault ? 'only-you' : 'everyone-in-workspace',
    }, null, 2) }] });
  }

  if (toolName === 'update_template') {
    const { id: templateId, title, content, description, variables, file_ids } = args;
    if (!templateId) return rpcError(id, -32602, 'id is required');

    const { data: existing } = await adminClient
      .from('prompts')
      .select('id, kind, content, created_by')
      .eq('workspace_id', workspaceId)
      .eq('id', templateId)
      .single();
    // SQEM-336, gate 1 — visibility. Until that ticket the write path scoped to the workspace and
    // nothing else, so a connection could overwrite a template it was not allowed to read. Same
    // wording whether the row is absent or merely invisible: two different answers turn the tool
    // into a way to test which ids exist. `delete_file` has said so since SQEM-291.
    if (!existing || !canAccessTemplate(templateId))
      return rpcError(id, -32602, `Template not found: ${templateId}`);
    // SQEM-473 — gate 2: seen is not editable.
    if (!(await mayEdit('template', templateId))) return refuseEdit(id, 'playbook');

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (title              !== undefined) updates.title              = title.trim();
    // SQEM-249 — same rule as create_template, and it has to be here too or an update re-introduces
    // the header that the create just removed.
    if (content            !== undefined) updates.content            = existing.kind === 'skill' ? withoutOwnFrontmatter(content) : content;
    if (description        !== undefined) updates.description        = description.trim();
    if (Array.isArray(file_ids))          updates.context_file_ids   = file_ids;

    // Variables: only for kind=prompt
    if (existing.kind === 'prompt') {
      if (Array.isArray(variables) && variables.length > 0) {
        updates.variables = normaliseVariables(variables);
      } else if (content !== undefined) {
        updates.variables = extractVariables(content ?? '');
      }
    }

    if (Object.keys(updates).length === 1)
      return rpcError(id, -32602, 'No fields to update — provide at least one of: title, content, description, variables, file_ids');
    // SQEM-477 — who the new version is by. Without it the version would carry the previous author.
    updates.updated_by = mcpUserId;

    const { data: updated, error: updateErr } = await adminClient
      .from('prompts')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', templateId)
      .select('id, title, kind')
      .single();

    if (updateErr || !updated)
      return rpcError(id, -32603, `Failed to update template: ${updateErr?.message ?? 'unknown error'}`);

    const updatedVars = updates.variables as any[] | undefined;
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id:    updated.id,
      name:  toSlug(updated.title),
      title: updated.title,
      kind:  updated.kind,
      ...(updatedVars !== undefined && {
        argumentCount: updatedVars.length,
        variables:     updatedVars.map((v: any) => v.name),
      }),
      ...(Array.isArray(file_ids) && { fileCount: file_ids.length }),
    }, null, 2) }] });
  }

  if (toolName === 'delete_template') {
    const templateId = args.id;
    if (!templateId) return rpcError(id, -32602, 'id is required');

    const { data: existing } = await adminClient
      .from('prompts')
      .select('id, title, kind, created_by')
      .eq('workspace_id', workspaceId)
      .eq('id', templateId)
      .single();
    // SQEM-336, gate 1 of 2 — visibility. Same wording for absent and invisible, so this cannot be
    // used to probe for ids (SQEM-291). Destroying something you were never allowed to see is the
    // worse half of the leak that note describes: with files you could only ask, here you can act.
    if (!existing || !canAccessTemplate(templateId))
      return rpcError(id, -32602, `Template not found: ${templateId}`);
    // SQEM-473 — gate 2: seen is not deletable.
    if (!(await mayEdit('template', templateId))) return refuseEdit(id, 'playbook', (existing as { title?: string }).title);

    const { error: deleteErr } = await adminClient
      .from('prompts')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', templateId);

    if (deleteErr)
      return rpcError(id, -32603, `Failed to delete template: ${deleteErr.message}`);

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      deleted: true,
      id:      existing.id,
      title:   existing.title,
      kind:    existing.kind,
    }, null, 2) }] });
  }

  // SQEM-248 — a skill folder arrives whole, because its bytes never pass through the model.
  //
  // The measurement that produced this tool: `diagram-design` was added over MCP and 26 of 152
  // files arrived. Not because anything rejected the rest — the paths, the extensions and the size
  // limits were all fine — but because 2 MB of file content cannot be emitted by a client that has
  // to hold a conversation as well. Any design that routes the bytes through the model has that
  // ceiling; this one does not, so the completeness question stops being a warning and becomes a
  // fact the server can state.
  if (toolName === 'import_skill_from_url') {
    const { url: rawUrl, path: pathArg } = args;
    if (!rawUrl?.trim()) return rpcError(id, -32602, 'url is required');

    let resolved: { archiveUrl: string; subPath: string | null };
    try { resolved = resolveArchiveUrl(rawUrl); }
    catch (err) { return rpcError(id, -32602, (err as Error).message); }

    let archive: Uint8Array;
    try { archive = await downloadArchive(resolved.archiveUrl); }
    catch (err) { return rpcError(id, -32603, `Could not download the archive: ${(err as Error).message}`); }

    let zip: JSZip;
    try { zip = await JSZip.loadAsync(archive); }
    catch { return rpcError(id, -32602, 'That URL did not return a readable zip archive.'); }

    const entryPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    let root: string;
    try { root = findSkillRoot(entryPaths, pathArg ?? resolved.subPath); }
    catch (err) { return rpcError(id, -32602, (err as Error).message); }

    const head = readSkillMd(await zip.files[`${root}${SKILL_ENTRY}`].async('string'));
    if (!head.description.trim()) {
      // Same rule as create_template: a skill without a description cannot be discovered, and a
      // skill nobody finds is not an import worth completing.
      return rpcError(id, -32602,
        `${SKILL_ENTRY} has no "description" in its frontmatter. A skill needs one — AI agents use it to discover the skill. Add it and re-run, or import the folder through the sqemes app and write one there.`);
    }

    // Everything beside SKILL.md, by relative path. SQEM-514: every file, whatever its type — a skill
    // is a folder, and the type is decided from the bytes at upload. `skipped` stays in the result
    // for the paths that are still left out (nothing today), so clients keep reading the same shape.
    const skipped: { name: string; reason: string }[] = [];
    // Indexed access rather than `JSZip.JSZipObject`: the namespace type resolves differently
    // under `npm:` specifiers, and nothing in CI type-checks this file to catch it.
    const members: { name: string; entry: (typeof zip.files)[string] }[] = [];
    for (const p of entryPaths) {
      if (!p.startsWith(root)) continue;
      const rel = p.slice(root.length);
      if (!rel || rel === SKILL_ENTRY || isArchiveJunk(rel)) continue;
      members.push({ name: rel, entry: zip.files[p] });
    }

    if (members.length > SKILL_MAX_FILES) {
      return rpcError(id, -32602, `That skill holds ${members.length} files, over the ${SKILL_MAX_FILES} limit for one import.`);
    }

    // Storage first, rows second, template last — so a failure anywhere leaves nothing attached to
    // a half-built template. Uploaded objects are removed on the way out; an orphan in the bucket
    // that no row points at is invisible and permanent.
    const uploaded: { fileId: string; storagePath: string; name: string; mimeType: string; sizeBytes: number }[] = [];
    const cleanUp = async () => {
      if (uploaded.length) {
        await adminClient.storage.from('workspace-files').remove(uploaded.map((u) => u.storagePath));
      }
    };

    // SQEM-251 — every file carries the skill's folder in front of it. `workspace_files` is one
    // flat namespace per workspace with no unique constraint on the name, so without this the
    // second imported skill merges its `references/` into the first one's — guaranteed, and a
    // same-named file becomes an indistinguishable twin row.
    const folder = skillSlug(head.title);

    let unpackedBytes = 0;
    try {
      await mapLimit(members, SKILL_UPLOAD_CONCURRENCY, async (member) => {
        const bytes = await member.entry.async('uint8array');
        unpackedBytes += bytes.byteLength;
        if (unpackedBytes > SKILL_MAX_UNPACKED_BYTES) {
          throw new Error(`unpacks to more than ${SKILL_MAX_UNPACKED_BYTES / 1048576} MB`);
        }

        const fileId = crypto.randomUUID();
        const workspaceName = `${folder}/${member.name}`;
        // The path stays in `name` — that is the folder tree (SQEM-244). Only the storage key is
        // flattened (SQEM-111/237), and the two must not be confused for each other.
        const storagePath = `${workspaceId}/${fileId}/${safeStorageFileName(workspaceName)}`;
        // SQEM-514 — the type comes from the bytes: text → text/plain in storage, its specific type
        // on the row; a proven image/PDF as itself; everything else application/octet-stream.
        const t = classifySkillFile(member.name, bytes);
        const { error } = await adminClient.storage
          .from('workspace-files')
          .upload(storagePath, bytes, { contentType: t.storageMime });
        if (error) throw new Error(`${member.name}: ${error.message}`);
        uploaded.push({ fileId, storagePath, name: workspaceName, mimeType: t.rowMime, sizeBytes: bytes.byteLength });
      });
    } catch (err) {
      await cleanUp();
      return rpcError(id, -32603, `Import stopped, nothing was kept: ${(err as Error).message}`);
    }

    const { error: rowsErr } = await adminClient.from('workspace_files').insert(
      uploaded.map((u) => ({
        id: u.fileId,
        workspace_id: workspaceId,
        name: u.name,
        mime_type: u.mimeType,
        size_bytes: u.sizeBytes,
        storage_path: u.storagePath,
        tags: [],
        created_by: mcpUserId, // SQEM-509 — see upload_file
      })),
    );
    if (rowsErr) {
      await cleanUp();
      return rpcError(id, -32603, `Import stopped, nothing was kept: ${rowsErr.message}`);
    }

    const restrictByDefault = await workspaceRestrictsNewTemplates(adminClient, workspaceId, mcpUserId);
    const { data: inserted, error: insertErr } = await adminClient
      .from('prompts')
      .insert({
        workspace_id:     workspaceId,
        kind:             'skill',
        title:            head.title.trim(),
        content:          head.content,
        description:      head.description.trim(),
        variables:        [],
        context_file_ids: uploaded.map((u) => u.fileId),
        created_by:       mcpUserId,
        updated_by:       mcpUserId, // SQEM-477
      })
      .select('id, title, kind')
      .single();

    if (insertErr || !inserted) {
      await adminClient.from('workspace_files').delete().in('id', uploaded.map((u) => u.fileId));
      await cleanUp();
      return rpcError(id, -32603, `Import stopped, nothing was kept: ${insertErr?.message ?? 'unknown error'}`);
    }

    if (restrictByDefault) {
      const { error: accessErr } = await adminClient
        .from('template_access')
        .insert({ template_id: inserted.id, workspace_id: workspaceId });
      if (accessErr) console.error('[mcp] SQEM-240 default access not applied', inserted.id, accessErr.message);
    }

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id:          inserted.id,
      title:       inserted.title,
      kind:        inserted.kind,
      source:      resolved.archiveUrl,
      skillFolder: root || '(archive root)',
      filesImported: uploaded.length,
      bytesImported: unpackedBytes,
      // Present even when empty: "skipped: []" is the sentence that makes a complete import
      // provable, and the absence of a warning is not the same thing.
      skipped,
    }, null, 2) }] });
  }

  if (toolName === 'upload_file') {
    const { name: fileName, content } = args;
    if (!fileName?.trim()) return rpcError(id, -32602, 'name is required');
    if (content == null)   return rpcError(id, -32602, 'content is required');

    // SQEM-514 — `content` is text by definition, so any name is accepted; the row type comes from
    // the extension when it names a text type and is text/plain otherwise (an .svg, a .drawio).
    const mimeType = TEXT_EXT_TO_MIME[extensionOf(fileName)] ?? STORAGE_TEXT_MIME;

    const fileId      = crypto.randomUUID();
    const safeFileName = safeStorageFileName(fileName); // SQEM-111/237 — no path separators / .. in the storage key
    const storagePath = `${workspaceId}/${fileId}/${safeFileName}`;
    const blob        = new Blob([content], { type: 'text/plain' });
    const sizeBytes   = new TextEncoder().encode(content).length;

    const { error: uploadErr } = await adminClient.storage
      .from('workspace-files')
      .upload(storagePath, blob, { contentType: 'text/plain' });
    if (uploadErr) return rpcError(id, -32603, `Storage upload failed: ${uploadErr.message}`);

    const { data: inserted, error: insertErr } = await adminClient
      .from('workspace_files')
      .insert({
        id:                fileId,
        workspace_id:      workspaceId,
        name:              fileName,
        mime_type:         mimeType,
        size_bytes:        sizeBytes,
        storage_path:      storagePath,
        tags:              [],
        // SQEM-509 — the service role skips guard_client_owned_columns(), which sets this for the
        // app. Without it a file no template lists any more is visible to nobody (can_access_file).
        created_by:        mcpUserId,
      })
      .select('id, name, mime_type')
      .single();

    if (insertErr || !inserted) {
      await adminClient.storage.from('workspace-files').remove([storagePath]);
      return rpcError(id, -32603, `Failed to save file record: ${insertErr?.message ?? 'unknown error'}`);
    }

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id:       inserted.id,
      name:     inserted.name,
      mimeType: inserted.mime_type,
    }, null, 2) }] });
  }

  if (toolName === 'create_upload_url') {
    const { name: fileName, mimeType } = args;
    if (!fileName?.trim()) return rpcError(id, -32602, 'name is required');
    if (!mimeType)         return rpcError(id, -32602, 'mimeType is required');
    // SQEM-514 — any file. Storage accepts only the types in SKILL_STORAGE_MIMES, so anything that is
    // not an image or a PDF is PUT as application/octet-stream; finalize_upload then decides from the
    // bytes what it really is.
    const putType = SKILL_STORAGE_MIMES.includes(mimeType) && mimeType !== STORAGE_TEXT_MIME ? mimeType : OCTET_STREAM;

    const fileId      = crypto.randomUUID();
    const safeFileName = safeStorageFileName(fileName); // SQEM-111/237 — no path separators / .. in the storage key
    const storagePath = `${workspaceId}/${fileId}/${safeFileName}`;

    const { data: signed, error: signErr } = await adminClient.storage
      .from('workspace-files')
      .createSignedUploadUrl(storagePath);
    if (signErr || !signed) {
      return rpcError(id, -32603, `Could not create upload URL: ${signErr?.message ?? 'unknown error'}`);
    }

    // SQEM-592 — the storage key above has its `/` defused, so it cannot tell finalize_upload what the
    // file is called. The announced name — folders included, which is what a skill's fonts/x.woff2
    // needs — travels across the PUT in this row.
    const { error: pendingErr } = await adminClient
      .from('pending_uploads')
      .insert({ file_id: fileId, workspace_id: workspaceId, name: fileName });
    if (pendingErr) {
      return rpcError(id, -32603, `Could not create upload URL: ${pendingErr.message}`);
    }

    // SQEM-522 — on the public host like every download link (SQEM-514). This line handed out the raw
    // storage URL (`*.supabase.co`, on self-host the internal one) since SQEM-059, so a sandbox that
    // allows only api.sqemes.com — what Help Center 54 tells admins to allow — could read but not upload.
    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      fileId,
      uploadUrl:        onPublicHost(signed.signedUrl, Deno.env.get('PUBLIC_API_URL') ?? null),
      token:            signed.token,
      path:             storagePath,
      contentType:      putType,
      expiresInSeconds: 7200,
      instructions:     `PUT the raw file bytes to uploadUrl with Content-Type: ${putType}, then call finalize_upload with this fileId.`,
    }, null, 2) }] });
  }

  if (toolName === 'finalize_upload') {
    const { fileId } = args;
    if (!fileId?.trim()) return rpcError(id, -32602, 'fileId is required');

    // Idempotent: if already registered, return it.
    const { data: existing } = await adminClient
      .from('workspace_files')
      .select('id, name, mime_type')
      .eq('workspace_id', workspaceId)
      .eq('id', fileId)
      .maybeSingle();
    // SQEM-291 — the `fileId` comes from the caller, so a foreign one can be passed here. Without
    // the visibility check this branch answers with a name and a MIME type for a file the caller
    // cannot otherwise see: an idempotency shortcut that doubles as a lookup.
    if (existing && !lib.canAccessFile(fileId)) {
      return rpcError(id, -32602, `File not found: ${fileId}`);
    }
    if (existing) {
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        id: existing.id, name: existing.name, mimeType: existing.mime_type, alreadyRegistered: true,
      }, null, 2) }] });
    }

    // Find the uploaded object under this fileId's folder.
    const { data: objects, error: listErr } = await adminClient.storage
      .from('workspace-files')
      .list(`${workspaceId}/${fileId}`);
    if (listErr) return rpcError(id, -32603, `Could not read storage: ${listErr.message}`);

    const obj = (objects || []).find((o: any) => o.id && o.name);
    if (!obj) {
      return rpcError(id, -32602,
        'No uploaded file found for this fileId. PUT the bytes to the create_upload_url first.');
    }

    const storagePath = `${workspaceId}/${fileId}/${obj.name}`;
    const storedMime  = obj.metadata?.mimetype ?? 'application/octet-stream';
    const sizeBytes   = obj.metadata?.size ?? 0;

    // SQEM-514 — what the file IS is read from its bytes (≤ 15 MB, the bucket limit). A declared
    // image or PDF must be one: storage would otherwise serve it under a type it is not.
    if (!SKILL_STORAGE_MIMES.includes(storedMime)) {
      await adminClient.storage.from('workspace-files').remove([storagePath]);
      return rpcError(id, -32602, `Uploaded with Content-Type "${storedMime}" — use the contentType create_upload_url returned.`);
    }
    const { data: blob, error: dlErr } = await adminClient.storage.from('workspace-files').download(storagePath);
    if (dlErr || !blob) return rpcError(id, -32603, `Could not read the upload: ${dlErr?.message ?? 'unknown error'}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const kind = classifySkillFile(obj.name, bytes);
    if (storedMime !== OCTET_STREAM && storedMime !== STORAGE_TEXT_MIME && sniffBinaryMime(bytes) !== storedMime) {
      await adminClient.storage.from('workspace-files').remove([storagePath]);
      return rpcError(id, -32602, `The bytes are not ${storedMime}. Upload it again with Content-Type: ${OCTET_STREAM}.`);
    }

    // SQEM-592 — the name create_upload_url was given, not the defused storage key. No row means the
    // URL was issued before this shipped; the key is then the best name there is, as it always was.
    const { data: pending } = await adminClient
      .from('pending_uploads')
      .select('name')
      .eq('file_id', fileId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    const fileName = uploadedFileName(pending?.name, obj.name);

    const { data: inserted, error: insertErr } = await adminClient
      .from('workspace_files')
      .insert({
        id:           fileId,
        workspace_id: workspaceId,
        name:         fileName,
        mime_type:    kind.rowMime,
        size_bytes:   sizeBytes,
        storage_path: storagePath,
        tags:         [],
        created_by:   mcpUserId, // SQEM-509 — see upload_file
      })
      .select('id, name, mime_type')
      .single();
    if (insertErr || !inserted) {
      return rpcError(id, -32603, `Failed to register file: ${insertErr?.message ?? 'unknown error'}`);
    }

    // Best effort: this upload's row, plus any of this workspace's that were never finalised.
    // A leftover row is harmless — it is never read again once its file is registered.
    // Two plain filters, not one `.or()`: fileId comes from the caller and must not be spliced into
    // PostgREST filter syntax.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await adminClient.from('pending_uploads').delete().eq('workspace_id', workspaceId).eq('file_id', fileId);
    await adminClient.from('pending_uploads').delete().eq('workspace_id', workspaceId).lt('created_at', dayAgo);

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      id: inserted.id, name: inserted.name, mimeType: inserted.mime_type,
    }, null, 2) }] });
  }

  if (toolName === 'delete_file') {
    const { fileId, force, replaceWith } = args;
    if (!fileId?.trim()) return rpcError(id, -32602, 'fileId is required');
    if (replaceWith && replaceWith === fileId)
      return rpcError(id, -32602, 'replaceWith must be a different file than the one being deleted');

    // 1. The file must exist in this workspace **and be one this caller can see**.
    //
    // SQEM-291 — deleting is a write, but the leak here is a read: the two answers "File not
    // found" and "deleted" differ, so without this check the tool doubles as a way to test whether
    // a given id exists in the workspace. Same wording either way, so an invisible file is
    // indistinguishable from an absent one.
    if (!lib.canAccessFile(fileId)) return rpcError(id, -32602, `File not found: ${fileId}`);

    const { data: file } = await adminClient
      .from('workspace_files')
      .select('id, name, storage_path, created_by')
      .eq('workspace_id', workspaceId)
      .eq('id', fileId)
      .maybeSingle();
    if (!file) return rpcError(id, -32602, `File not found: ${fileId}`);

    // 2. An optional replacement file must also exist in this workspace.
    let replacement: { id: string; name: string } | null = null;
    if (replaceWith) {
      const { data: rep } = await adminClient
        .from('workspace_files')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('id', replaceWith)
        .maybeSingle();
      if (!rep || !lib.canAccessFile(replaceWith))
        return rpcError(id, -32602, `replaceWith file not found: ${replaceWith}`);
      replacement = rep;
    }

    // 3. Which templates still reference this file? (context_file_ids is uuid[])
    const { data: refs } = await adminClient
      .from('prompts')
      .select('id, title, kind, context_file_ids')
      .eq('workspace_id', workspaceId)
      .contains('context_file_ids', [fileId]);
    const referencedBy = refs || [];

    // SQEM-234 — the count is deliberately complete, the names are not. `referencedBy` comes from
    // the service role and therefore includes templates this caller has no access to; returning
    // their titles turned "try to delete a file" into a way to read the name of someone else's
    // private template. Same trade as the Files page, from the other side: the number is what
    // makes the file protectable, the title is what leaks.
    const nameable = referencedBy.filter((t: any) => canAccessTemplate(t.id));
    const restricted = referencedBy.length - nameable.length;

    // 4. Blocked: still attached elsewhere and no explicit force/replaceWith.
    //    Return the referencing templates so the assistant can confirm with the
    //    user before touching them (a tool can't prompt the user itself).
    if (referencedBy.length > 0 && !force && !replaceWith) {
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
        deleted: false,
        blocked: true,
        reason: `This file is still attached to ${referencedBy.length} other template(s)${restricted > 0 ? `, ${restricted} of which you cannot see` : ''}. Confirm with the user before removing it from them.`,
        referencedBy: nameable.map((t: any) => ({ id: t.id, title: t.title, kind: t.kind })),
        ...(restricted > 0 ? { restrictedCount: restricted } : {}),
        howToProceed: 'Call delete_file again with force:true to detach the file from these templates and delete it, or replaceWith:<fileId> to swap in a replacement file for each of them first.',
      }, null, 2) }] });
    }

    // 4b. SQEM-340 — proceeding would change templates this caller cannot see.
    //
    // ⛔ A different question from "may you write at all", and it needs a different predicate.
    // The central gate asks whether this *connection* may write; here the objects being changed
    // are not the file but every template the detach or swap touches.
    //
    // The blocked response above already admits the reach ("3 of which you cannot see") and then
    // let the caller proceed anyway. That is informed consent to a number whose contents are
    // unknown: you learn THAT three colleagues' templates are affected, never which or how badly.
    // Not a basis for an irreversible change to someone else's work.
    //
    // ⛔ **Since SQEM-346 this check can no longer fire, and it stays anyway. Read why before
    // deleting it.**
    //
    // It used to constrain exactly one caller — the workspace-wide key, which passed the central
    // gate on `!mcpUserId` and was bounded only by its narrow sight. That caller no longer exists,
    // and everyone who now reaches this line is already an editor or admin, so the condition is
    // provably false.
    //
    // ⚠️ It is kept because it is the **only** place in this file where "reach may not exceed
    // sight" is enforced rather than inherited. Today that property follows from `mayWrite`; the
    // moment anything widens `mayWrite` — a service identity, an automation role, a scope that
    // grants rather than narrows — this line is what still holds, and whoever makes that change is
    // unlikely to rediscover the rule from scratch. Three lines of dead code against one silent
    // reintroduction of the hole SQEM-340 closed.
    if (restricted > 0 && !mcpUserManagesContent) {
      return rpcError(id, -32602,
        `This file is attached to ${restricted} template(s) you cannot see. Detaching or replacing it there would change work you have no access to, so it needs an editor or admin. Ask one, or remove the file only from the templates you can see (update_template with file_ids).`);
    }

    // SQEM-473 — detaching or swapping changes every referencing playbook, so each must be one this
    // person may edit. A playbook that restricts its editors protects its files this way; the app
    // enforces the same rule through `workspace_files_update`.
    for (const t of referencedBy) {
      if (!(await mayEdit('template', t.id))) {
        return rpcError(id, -32602,
          `This file belongs to a playbook you may use but not change${canAccessTemplate(t.id) ? ` ("${t.title}")` : ''}. Detaching or replacing it there needs that playbook's owner or a workspace admin.`);
      }
    }

    // 5. Detach (or swap for the replacement) on every referencing template.
    const affected: { id: string; title: string; kind: string }[] = [];
    for (const t of referencedBy) {
      const current: string[] = t.context_file_ids || [];
      let next = replaceWith
        ? current.map((fid: string) => (fid === fileId ? replaceWith : fid))
        : current.filter((fid: string) => fid !== fileId);
      next = next.filter((fid: string, i: number) => next.indexOf(fid) === i); // de-dupe
      const { error: updErr } = await adminClient
        .from('prompts')
        .update({ context_file_ids: next, updated_at: new Date().toISOString(), updated_by: mcpUserId }) // SQEM-477
        .eq('workspace_id', workspaceId)
        .eq('id', t.id);
      if (updErr) return rpcError(id, -32603, `Failed to update template ${t.id}: ${updErr.message}`);
      affected.push({ id: t.id, title: t.title, kind: t.kind });
    }

    // 6. Delete the storage object, then the file row. Nothing references the
    //    file anymore, so no dangling uuid[] entries are left behind.
    // SQEM-492 — only ever remove an object inside this workspace's folder.
    if (isPathInWorkspace(file.storage_path, workspaceId)) {
      await adminClient.storage.from('workspace-files').remove([file.storage_path]);
    }
    const { error: delErr } = await adminClient
      .from('workspace_files')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', fileId);
    if (delErr) return rpcError(id, -32603, `Failed to delete file: ${delErr.message}`);

    return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify({
      deleted: true,
      id:      file.id,
      name:    file.name,
      ...(replacement
        ? { replacedWith: replacement, reattachedTo: affected }
        : { detachedFrom: affected }),
    }, null, 2) }] });
  }

  return rpcError(id, -32602, `Unknown tool: ${toolName}`);
}
