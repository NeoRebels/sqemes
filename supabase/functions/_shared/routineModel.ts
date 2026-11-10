/**
 * SQEM-678 — which model a routine run uses, decided in `routine-run` before anything starts.
 *
 * `routines.model = null` means **the workspace's default**: the default AI model
 * (`workspaces.authoring_model_id`) when the workspace has a key for its provider, otherwise the plan's
 * credits. ⚠️ Until SQEM-678 null meant "credits" alone; a workspace without a key still gets exactly that.
 *
 * A model the person chose stays — unless it cannot run: no key for its provider any more, or an id no
 * provider is recognised for. Then the run takes the default and says so under the answer, instead of
 * failing three days in a row until the routine pauses. A model the provider no longer knows only shows
 * at the provider; for that the ticket carries `fallback`, and `chat-message` tries it once (see there).
 *
 * ⛔ No model catalogue on the server. The editor writes a concrete model
 * when the workspace has no default set; a catalogue update that removes a model moves the routines on it
 * to the default in its own migration (`pm/DOCUMENTATION.md` → Routines, in the source repository).
 *
 * Deliberately free of imports beyond `modelProvider.ts`, so tests/unit reach every rule.
 */
import { providerOfModelId } from './modelProvider.ts';

/** The editor's id for the plan's credits (`lib/enabledModels.ts`, SQEM-082) — pinned equal by a unit test. */
export const FUNDED_MODEL_ID = 'sqemes-ai-model';

export type ModelChoice = { modelId: string } | { funded: true };

export interface RoutineModel {
  /** What this run starts with. */
  primary: ModelChoice;
  /** Tried once when the provider says it does not know `primary`'s model; null when there is nothing else. */
  fallback: ModelChoice | null;
  /** Set when the chosen model could not be used at all and the run starts on the default instead. */
  replaced: string | null;
}

function same(a: ModelChoice, b: ModelChoice): boolean {
  return 'funded' in a ? 'funded' in b : !('funded' in b) && a.modelId === b.modelId;
}

export function workspaceDefaultModel(authoringModelId: string | null, keyProviders: ReadonlySet<string>): ModelChoice {
  const provider = authoringModelId ? providerOfModelId(authoringModelId) : null;
  return authoringModelId && provider && keyProviders.has(provider) ? { modelId: authoringModelId } : { funded: true };
}

export function resolveRoutineModel(
  stored: string | null,
  authoringModelId: string | null,
  keyProviders: ReadonlySet<string>,
): RoutineModel {
  const byDefault = workspaceDefaultModel(authoringModelId, keyProviders);
  if (!stored) return { primary: byDefault, fallback: null, replaced: null };
  // Chosen in the editor on a keyless workspace (SQEM-082's sentinel): the credits, as in Chat.
  if (stored === FUNDED_MODEL_ID) return { primary: { funded: true }, fallback: null, replaced: null };
  const provider = providerOfModelId(stored);
  if (!provider || !keyProviders.has(provider)) return { primary: byDefault, fallback: null, replaced: stored };
  const primary: ModelChoice = { modelId: stored };
  return { primary, fallback: same(primary, byDefault) ? null : byDefault, replaced: null };
}

/** Under the answer when the run did not use the model the person chose. */
export function routineModelReplacedNote(model: string, locale: 'de' | 'en'): string {
  return locale === 'de'
    ? `Das Modell ${model} ist nicht mehr verfügbar, deshalb lief diese Routine mit dem Standardmodell des Workspace. Wähle in der Routine ein anderes Modell oder „Standard des Workspace“.`
    : `The model ${model} is no longer available, so this routine ran with the workspace's default model. Choose another model, or "Workspace default", in the routine.`;
}
