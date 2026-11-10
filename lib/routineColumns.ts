/**
 * SQEM-677 — what the client writes into `routines`, and how the database's refusals are told apart.
 *
 * ⛔ `ROUTINE_CLIENT_COLUMNS` is the INSERT grant of `20261109200000_sqem675_routines.sql`, copied on
 * purpose and pinned by `tests/unit/routinesUi.test.ts`: a column outside it fails the whole insert
 * with a permission error, which reads to the person like "saving does not work".
 *
 * Pure, types-only imports — tested directly (lib/supabase throws at import time without env vars).
 */
import type { RoutineInput } from '../types';

export const ROUTINE_CLIENT_COLUMNS = [
  'workspace_id', 'name', 'prompt', 'persona_id', 'playbook_ids', 'connector_ids', 'model', 'web_search',
  'days', 'time_of_day', 'time_zone', 'paused_reason',
] as const;

/** The editor's values as a row; `workspace_id` and `paused_reason` are added by the caller. */
export function routineRow(input: RoutineInput) {
  return {
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    persona_id: input.personaId,
    playbook_ids: input.playbookIds,
    connector_ids: input.connectorIds,
    model: input.model,
    web_search: input.webSearch,
    days: input.days,
    time_of_day: input.timeOfDay,
    time_zone: input.timeZone,
  };
}

export type RoutineErrorKind = 'limit' | 'timezone' | 'reference' | 'other';

/**
 * Which refusal of `routines_guard` this is. The limit carries `hint = 'routine_limit'`; the others are
 * told apart by their message, which the guard writes in English and never shows a person.
 */
export function routineErrorKind(error: { message?: string; hint?: string | null }): RoutineErrorKind {
  if (error.hint === 'routine_limit' || /at most 5 active routines/.test(error.message ?? '')) return 'limit';
  if (/unknown time zone/.test(error.message ?? '')) return 'timezone';
  if (/(persona|playbook|connector) not found/.test(error.message ?? '')) return 'reference';
  return 'other';
}
