/**
 * SQEM-561 — what a chat answer changed in the library, as the card under the answer shows it.
 *
 * The chat function builds one entry per successful write (`describeChange`), broadcasts them with
 * the result, and the client stores them on the answer (`chat_messages.library_changes`). Import-free,
 * so the browser imports it from here (as it does `chatPlaybooks.ts`) and an edge function can too.
 *
 * ⚠️ The title is stored, unlike SQEM-551's "Used" ids. A deleted playbook can no longer be looked up,
 * and "deleted: a playbook" tells the person who asked for it nothing. The card still prefers the
 * viewer's own list: an entry the viewer can open shows its CURRENT title with a link; one they cannot
 * open shows the stored title only when it was deleted — the answer above it names it anyway — and
 * nothing identifying otherwise (`changeLabel`).
 */

export type LibraryChangeAction = 'created' | 'updated' | 'deleted';
export type LibraryChangeKind = 'prompt' | 'skill' | 'persona' | 'file';

export interface LibraryChange {
  action: LibraryChangeAction;
  kind: LibraryChangeKind;
  id: string;
  title: string;
}

/** Matches the CHECK on `chat_messages.library_changes` (migration 20261022200000). */
export const MAX_LIBRARY_CHANGES = 20;
export const MAX_CHANGE_TITLE = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS: LibraryChangeAction[] = ['created', 'updated', 'deleted'];
const KINDS: LibraryChangeKind[] = ['prompt', 'skill', 'persona', 'file'];

function clip(s: string): string {
  return s.length > MAX_CHANGE_TITLE ? `${s.slice(0, MAX_CHANGE_TITLE - 1)}…` : s;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function entry(action: LibraryChangeAction, kind: unknown, id: unknown, title: unknown): LibraryChange | null {
  if (!KINDS.includes(kind as LibraryChangeKind) || typeof id !== 'string' || !UUID.test(id)) return null;
  return { action, kind: kind as LibraryChangeKind, id, title: clip(str(title).trim()) };
}

/**
 * The change one successful tool call made, read from the tool's own JSON answer (the shapes in
 * `_shared/libraryActions.ts`). `null` for a read, a refusal, or a call that changed nothing — a
 * blocked `delete_file` answers successfully with `deleted: false`.
 */
export function describeChange(tool: string, args: Record<string, unknown>, resultText: string): LibraryChange | null {
  let r: Record<string, unknown>;
  try {
    const parsed = JSON.parse(resultText);
    if (!parsed || typeof parsed !== 'object') return null;
    r = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (tool) {
    case 'create_template':
    case 'import_skill_from_url':
      return entry('created', r.kind, r.id, r.title);
    case 'update_template':
      return entry('updated', r.kind, r.id, r.title);
    case 'delete_template':
      return r.deleted === true ? entry('deleted', r.kind, r.id, r.title) : null;
    case 'create_persona':
      return entry('created', 'persona', r.id, r.title);
    case 'update_persona':
      // The answer names the fields, not the title; a new title is in the arguments.
      return r.updated === true ? entry('updated', 'persona', r.id, args.title) : null;
    case 'delete_persona':
      return r.deleted === true ? entry('deleted', 'persona', r.id, r.title) : null;
    case 'attach_template':
    case 'detach_template':
      // A route belongs to its persona: the persona is what changed.
      return entry('updated', 'persona', args.persona_id, r.persona);
    case 'upload_file':
      return entry('created', 'file', r.id, r.name);
    case 'delete_file':
      return r.deleted === true ? entry('deleted', 'file', r.id, r.name) : null;
    default:
      return null;
  }
}

/**
 * Adds a change, merging repeats: the same object touched twice in one answer is one line. A delete
 * wins over anything before it; a create stays a create when it is edited afterwards.
 */
export function addChange(list: LibraryChange[], c: LibraryChange): void {
  const at = list.findIndex(x => x.id === c.id && x.kind === c.kind);
  if (at === -1) {
    if (list.length < MAX_LIBRARY_CHANGES) list.push(c);
    return;
  }
  const prev = list[at];
  const action = c.action === 'deleted' ? 'deleted' : prev.action === 'created' ? 'created' : c.action;
  list[at] = { ...prev, action, title: c.title || prev.title };
}

/** Read side: the column is written by a member's client, so anything malformed is dropped. */
export function normalizeLibraryChanges(raw: unknown): LibraryChange[] {
  if (!Array.isArray(raw)) return [];
  const out: LibraryChange[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!ACTIONS.includes(o.action as LibraryChangeAction)) continue;
    const e = entry(o.action as LibraryChangeAction, o.kind, o.id, o.title);
    if (e && !out.some(y => y.id === e.id && y.kind === e.kind)) out.push(e);
    if (out.length === MAX_LIBRARY_CHANGES) break;
  }
  return out;
}

/**
 * What the card shows for one entry. `current` is the title from the viewer's own list, or undefined
 * when they cannot see the object (or it no longer exists).
 */
export function changeLabel(c: LibraryChange, current: string | undefined): { title: string; linked: boolean } {
  if (current !== undefined && c.action !== 'deleted') return { title: current, linked: true };
  if (c.action === 'deleted' && c.title) return { title: c.title, linked: false };
  const noun = c.kind === 'persona' ? 'a persona' : c.kind === 'file' ? 'a file' : 'a playbook';
  return { title: `${noun} you cannot open`, linked: false };
}
