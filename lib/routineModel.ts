/**
 * SQEM-678 — the model choice in the routine editor. Pure (no Supabase import), so tests/unit reach it.
 *
 * "Workspace default" is saved as `model = null`, and `routine-run` resolves it on every run
 * (`supabase/functions/_shared/routineModel.ts`): the default AI model when its key exists, otherwise the
 * plan's credits. So the editor offers it exactly where the server's answer and Chat's agree:
 * - the workspace has a default AI model it can use → that model;
 * - the workspace has no text key but credits → the credits (`sqemes AI`).
 * ⛔ Not offered when keys exist but no default is set. Chat then takes the
 * first model with a key — list order the server does not know — so the editor writes that model down
 * instead, and says so.
 */
import { FUNDED_MODEL_ID, buildEnabledModels, isImageModel } from './enabledModels';
import type { Workspace } from '../types';

type ModelWorkspace = Pick<Workspace, 'apiKeys' | 'openrouterModels' | 'fundedAvailable' | 'authoringModelId'>;

/** The editor's value for "Workspace default"; saved as null. */
export const DEFAULT_MODEL = 'workspace-default';

export interface RoutineModelOptions {
  /** The model "Workspace default" stands for today, or null when it is not offered. */
  defaultId: string | null;
  /** What a new routine starts with: DEFAULT_MODEL when offered, else Chat's first text model ('' = none). */
  initial: string;
}

export function routineModelOptions(ws: ModelWorkspace): RoutineModelOptions {
  const text = buildEnabledModels(ws.apiKeys, ws.openrouterModels ?? [], ws.fundedAvailable).filter(x => !isImageModel(x.id));
  const chosen = ws.authoringModelId && text.some(x => x.id === ws.authoringModelId && x.id !== FUNDED_MODEL_ID) ? ws.authoringModelId : null;
  if (chosen) return { defaultId: chosen, initial: DEFAULT_MODEL };
  // buildEnabledModels offers the credits only when no text key exists (SQEM-082).
  if (text.length === 1 && text[0].id === FUNDED_MODEL_ID) return { defaultId: FUNDED_MODEL_ID, initial: DEFAULT_MODEL };
  return { defaultId: null, initial: text[0]?.id ?? '' };
}

/** A chosen model the editor cannot list any more (removed from the catalogue, or its key is gone). */
export function isUnavailableModel(model: string | null, usable: readonly { id: string }[]): boolean {
  return !!model && !usable.some(x => x.id === model);
}

/** A random minute from 07:00 to 08:59, so new routines do not all start at the same minute. */
export function randomStartTime(random: () => number = Math.random): string {
  const minutes = 7 * 60 + Math.min(119, Math.floor(random() * 120));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
