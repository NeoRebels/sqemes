import { supabase } from '../supabase';
import type { Database } from '../database.types';
import type { Routine, RoutineInput } from '../../types';
import { routineRow, routineErrorKind, type RoutineErrorKind } from '../routineColumns';

/**
 * SQEM-677 — a person's own routines (SQEM-675). RLS returns only their own, while they are a member;
 * the guard trigger decides the rest (references, the limit of 5 active, the next run).
 */
type RoutineRow = Database['public']['Tables']['routines']['Row'];

function rowToRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    prompt: row.prompt,
    personaId: row.persona_id,
    playbookIds: row.playbook_ids ?? [],
    connectorIds: row.connector_ids ?? [],
    model: row.model,
    webSearch: row.web_search,
    days: row.days ?? [],
    timeOfDay: row.time_of_day,
    timeZone: row.time_zone,
    pausedReason: row.paused_reason,
    nextRunAt: row.next_run_at,
    lastSessionId: row.last_session_id,
    createdAt: row.created_at,
  };
}

/** A refusal from the database, with the kind the page turns into a sentence. */
export class RoutineSaveError extends Error {
  constructor(public kind: RoutineErrorKind, message: string) { super(message); }
}

const fail = (error: { message?: string; hint?: string | null }): never => {
  throw new RoutineSaveError(routineErrorKind(error), error.message ?? 'error');
};

export async function fetchRoutines(workspaceId: string): Promise<Routine[]> {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToRoutine);
}

export async function fetchRoutine(id: string): Promise<Routine | null> {
  const { data, error } = await supabase.from('routines').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToRoutine(data) : null;
}

/**
 * Creates a routine, active when there is room. With five active already the database refuses an
 * active one; then it is saved paused and `paused` says so (SQEM-677: never lose what was typed).
 */
export async function createRoutine(workspaceId: string, input: RoutineInput): Promise<{ routine: Routine; paused: boolean }> {
  const insert = async (paused: boolean) => supabase
    .from('routines')
    .insert({ workspace_id: workspaceId, ...routineRow(input), paused_reason: paused ? 'user' : null })
    .select('*')
    .single();
  let { data, error } = await insert(false);
  if (error && routineErrorKind(error) === 'limit') {
    ({ data, error } = await insert(true));
    if (!error && data) return { routine: rowToRoutine(data), paused: true };
  }
  if (error || !data) return fail(error ?? {});
  return { routine: rowToRoutine(data), paused: false };
}

export async function updateRoutine(id: string, input: RoutineInput): Promise<Routine> {
  const { data, error } = await supabase.from('routines').update(routineRow(input)).eq('id', id).select('*').single();
  if (error || !data) return fail(error ?? {});
  return rowToRoutine(data);
}

/** Pause (`user`) or resume. Resuming may hit the limit of five active. */
export async function setRoutinePaused(id: string, paused: boolean): Promise<Routine> {
  const { data, error } = await supabase
    .from('routines')
    .update({ paused_reason: paused ? 'user' : null })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return fail(error ?? {});
  return rowToRoutine(data);
}

/** Deletes the routine; its chats stay in the History (`routine_id` becomes null). */
export async function deleteRoutine(id: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('id', id);
  if (error) throw error;
}

/**
 * SQEM-679 — whether this instance can run routines (both Vault entries set). Asked on self-host only:
 * Cloud has them, and an operator on their own Supabase without them must not see routines that never run.
 */
export async function fetchRoutinesAvailable(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('routines_available');
    return !error && data === true;
  } catch {
    return false;
  }
}
