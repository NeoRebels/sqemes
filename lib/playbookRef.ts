/**
 * SQEM-551 — what a chat message remembers about the playbooks around it. Pure, types-only imports,
 * so it is tested directly (lib/supabase throws at import time without env vars).
 *
 * Two things, on two kinds of message:
 *
 * - **`PlaybookRef` on a user message** — the prompt playbook it was started from: id, title, kind,
 *   the fields as they were filled in, and `edited` when the text sent differs from the text the
 *   playbook produced. The card shows it IN ADDITION to the text, because the text is what the model
 *   actually received. The title is stored, not looked up: a deleted playbook
 *   keeps its card, just without a link.
 * - **`loaded_template_ids` on an answer** — only what the model loaded for exactly that answer
 *   (`get_template` in the chat function). Ids, never titles: the chips resolve titles from the
 *   viewer's own playbook list, so in a shared chat nobody sees the name of a playbook they cannot
 *   open.
 *
 * ⚠️ Both arrive from the database, written by any member's client, so both are parsed defensively.
 * The caps below match the CHECK constraints of migration 20261021213000.
 */
import type { PlaybookRef, PlaybookRefField, PromptKind, Variable } from '../types';
import { MAX_LOADED_IDS } from '../supabase/functions/_shared/chatPlaybooks.ts';
import { normalizeLibraryChanges, type LibraryChange } from '../supabase/functions/_shared/libraryChanges.ts';
import { normalizeWebSources, type WebSources } from '../supabase/functions/_shared/webSearch.ts';
import { normalizeGeneratedFiles, type GeneratedFile } from '../supabase/functions/_shared/fileOutput.ts';

export { MAX_LOADED_IDS };

// Worst case, every character 4 bytes in UTF-8: 20 × (80 + 300) × 4 + 200 × 4 ≈ 31 KB, under the
// 64 KB the database allows — the client caps are the real limit, the CHECK is the backstop.
export const MAX_REF_FIELDS = 20;
export const MAX_FIELD_NAME = 80;
export const MAX_FIELD_VALUE = 300;
export const MAX_REF_TITLE = 200;

export type { PlaybookRef, PlaybookRefField };

/**
 * Held by Chat between "Insert" and "Send": the ref without `edited`, plus the text it produced.
 * `editedBefore` carries the flag through "Edit" on an already-sent message, whose text is the
 * comparison point from then on — an edit of an edited message must not read as unedited.
 */
export interface PendingPlaybookRef {
  ref: Omit<PlaybookRef, 'edited'>;
  insertedText: string;
  editedBefore?: boolean;
}

/** "Edit" on a sent message that had a card: the card comes back with it. */
export function pendingFromSent(ref: PlaybookRef | null | undefined, sentText: string): PendingPlaybookRef | null {
  if (!ref) return null;
  const { edited, ...rest } = ref;
  return { ref: rest, insertedText: sentText, editedBefore: edited };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Built when a prompt playbook is inserted into the composer. File fields are left out — their
 * value is a file, not text, and the file already travels with the message.
 */
export function buildPendingRef(
  template: { id: string; title: string; kind: PromptKind },
  variables: Pick<Variable, 'name' | 'label' | 'type'>[],
  inputs: Record<string, string>,
  insertedText: string,
): PendingPlaybookRef {
  const fields = variables
    .filter(v => v.type !== 'file')
    .map(v => ({ name: clip(v.label || v.name, MAX_FIELD_NAME), value: clip((inputs[v.name] ?? '').trim(), MAX_FIELD_VALUE) }))
    .filter(f => f.value !== '')
    .slice(0, MAX_REF_FIELDS);
  return {
    ref: { id: template.id, title: clip(template.title, MAX_REF_TITLE), kind: template.kind, fields },
    insertedText,
  };
}

/** At send time. `null` when nothing was inserted, or the composer was emptied since. */
export function finalizeRef(pending: PendingPlaybookRef | null, sentText: string): PlaybookRef | null {
  if (!pending || !sentText.trim()) return null;
  return { ...pending.ref, edited: !!pending.editedBefore || sentText.trim() !== pending.insertedText.trim() };
}

/** Read side: anything that is not a well-formed ref is no ref at all. */
export function parsePlaybookRef(raw: unknown): PlaybookRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.title !== 'string' || !r.title.trim()) return null;
  if (r.kind !== 'prompt' && r.kind !== 'skill') return null;
  const fields = Array.isArray(r.fields)
    ? r.fields
        .filter((f): f is PlaybookRefField => !!f && typeof f === 'object'
          && typeof (f as PlaybookRefField).name === 'string' && typeof (f as PlaybookRefField).value === 'string')
        .slice(0, MAX_REF_FIELDS)
        .map(f => ({ name: f.name, value: f.value }))
    : [];
  return { id: r.id, title: r.title, kind: r.kind, fields, edited: r.edited === true };
}

/** Both sides: unique uuids, in the order loaded, at most MAX_LOADED_IDS. */
export function normalizeLoadedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && UUID.test(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_LOADED_IDS) break;
  }
  return out;
}

/**
 * The ONE mapping from a `chat_messages` row to the two fields — used by the history load
 * (lib/api/chatSessions.ts) AND Chat's Realtime insert handler. Two hand-written copies would let
 * the card appear for the sender and silently not for a collaborator.
 */
export function messagePlaybookFields(row: { playbook_ref?: unknown; loaded_template_ids?: unknown; library_changes?: unknown; web_sources?: unknown; generated_files?: unknown }): {
  playbookRef: PlaybookRef | null;
  loadedTemplateIds: string[];
  libraryChanges: LibraryChange[];
  webSources: WebSources | null;
  generatedFiles: GeneratedFile[];
} {
  return {
    playbookRef: parsePlaybookRef(row.playbook_ref),
    loadedTemplateIds: normalizeLoadedIds(row.loaded_template_ids),
    libraryChanges: normalizeLibraryChanges(row.library_changes), // SQEM-561 — the card under an answer
    webSources: normalizeWebSources(row.web_sources), // SQEM-594 — what the answer searched and read
    generatedFiles: normalizeGeneratedFiles(row.generated_files), // SQEM-595 — files handed out with it
  };
}

/** The chips: loaded ids the viewer can see, with their title; the rest is left out silently. */
export function usedPlaybooks(
  ids: string[] | undefined,
  visible: ReadonlyMap<string, { title: string; kind: PromptKind }>,
): { id: string; title: string; kind: PromptKind }[] {
  return (ids ?? []).flatMap(id => {
    const p = visible.get(id);
    return p ? [{ id, title: p.title, kind: p.kind }] : [];
  });
}
