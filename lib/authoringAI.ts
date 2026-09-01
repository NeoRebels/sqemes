import { supabase } from './supabase';
import { waitForJobResult } from './realtimeJob';
import { AVAILABLE_MODELS } from '../constants';
import { isImageModel, buildEnabledModels } from './enabledModels';
import type { Workspace } from '../types';

/**
 * First enabled *text* (non-image) model id for the workspace's configured keys,
 * or null when no provider key is set.
 *
 * ⚠️ **This is the fallback, not the setting** (SQEM-311). It answers "which model, if nobody
 * chose?" — and the answer is the first entry in `AVAILABLE_MODELS` with a key, which is **list
 * order, not a judgement**: that list is sorted by provider (SQEM-278), not by how well a model
 * writes. Use `authoringModelId()` at call sites; this one exists so that function has something to
 * fall back to.
 */
export function firstTextModelId(apiKeys: Record<string, string | undefined>): string | null {
  const enabled = AVAILABLE_MODELS.filter(m => {
    const key = apiKeys[m.provider];
    return key && key.length > 0;
  });
  return enabled.find(m => !isImageModel(m.id))?.id ?? null;
}

/** Why the workspace's authoring model is what it is — the UI needs the reason, not just the id. */
export type AuthoringModelState = {
  /** What the workspace stored, even when it cannot be used right now. */
  chosenId: string | null;
  /** What will actually run. Null ⇒ no BYOK text model at all (funded credits, or nothing). */
  effectiveId: string | null;
  /**
   * `chosen` — the stored choice is in effect.
   * `auto` — nothing was chosen; the first text model with a key is used.
   * `unavailable` — something *was* chosen and cannot be used: retired from the catalogue, or its
   *   provider key is gone. **The two are one status on purpose** — the fix is the same (choose
   *   again) and distinguishing them would put the catalogue's history in the UI.
   * `none` — no text model is available at all.
   */
  status: 'chosen' | 'auto' | 'unavailable' | 'none';
};

/**
 * SQEM-311 — the model that does AI authoring for this workspace: enhance, generated descriptions,
 * both wizards, "Adapt to brand", the website analysis.
 *
 * ⛔ **A stored id is validated on every read, never trusted.** Three ordinary things invalidate it
 * and all three look identical from the outside — *it just used something else*:
 *
 * 1. the model is retired from `AVAILABLE_MODELS` (SQEM-278 removed nine in one go);
 * 2. the provider's API key is deleted after the choice was made;
 * 3. the workspace has no BYOK key at all and runs on funded credits, where **the server picks** and
 *    a selection here would be pretending to control something it does not.
 *
 * Falling back silently would reproduce the very problem this ticket exists to fix — a model chosen
 * by accident with nothing saying so. Hence `status`: the caller can show it.
 */
export function authoringModelState(workspace: Pick<Workspace, 'apiKeys' | 'authoringModelId'>): AuthoringModelState {
  const chosenId = workspace.authoringModelId ?? null;
  const auto = firstTextModelId(workspace.apiKeys);
  if (!auto) return { chosenId, effectiveId: null, status: 'none' };
  if (!chosenId) return { chosenId: null, effectiveId: auto, status: 'auto' };

  const model = AVAILABLE_MODELS.find(m => m.id === chosenId);
  const keyed = !!model && !!workspace.apiKeys[model.provider as keyof Workspace['apiKeys']];
  if (!model || !keyed || isImageModel(chosenId)) return { chosenId, effectiveId: auto, status: 'unavailable' };
  return { chosenId, effectiveId: chosenId, status: 'chosen' };
}

/**
 * SQEM-320 — is there another authoring model to switch to?
 *
 * ⛔ **Only answered here so it cannot be answered four different ways.** Four call sites frame
 * provider errors (`describeAIError`), and each would otherwise inline its own version of "more than
 * one model" — the pattern this project has written down twice already.
 *
 * ⚠️ **False is the safe answer, and the common one.** A workspace with a single provider key, or
 * one running on funded credits, has nothing to switch to; pointing it at the authoring-model
 * setting would send somebody to a section that offers nothing. That is exactly the defect SQEM-310
 * removed and SQEM-311 only *partly* undid — the setting exists now, but having it is not the same
 * as having a choice.
 */
export function hasAuthoringAlternatives(workspace: Pick<Workspace, 'apiKeys' | 'openrouterModels'> | null | undefined): boolean {
  if (!workspace) return false;
  return buildEnabledModels(workspace.apiKeys, workspace.openrouterModels).filter(m => !isImageModel(m.id)).length > 1;
}

/** The id to send. Shorthand for `authoringModelState(...).effectiveId`. */
export function authoringModelId(workspace: Pick<Workspace, 'apiKeys' | 'authoringModelId'>): string | null {
  return authoringModelState(workspace).effectiveId;
}

export interface AuthoringAIParams {
  workspaceId: string;
  /** BYOK model id, or `null`/`undefined` to route to Sqemes-funded credits (keyless). */
  modelId: string | null;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  /**
   * SQEM-316 — documents to send alongside the prompt: PDFs and images, base64, no `data:` prefix.
   *
   * ⚠️ **`execute-step` has always accepted this** — its `promptContent` is typed `string | any[]`
   * and Chat has been sending file parts through it for months. Authoring simply never offered the
   * option, which is why the wizard could only refuse a PDF rather than read one.
   *
   * ⛔ **Whether a given provider can actually use a PDF is decided before this is called**, by
   * `classifyUpload` in `lib/wizardUploads.ts`. Two providers drop them server-side without a word,
   * and a template written from a document that never arrived is the expensive kind of wrong.
   */
  attachments?: { mimeType: string; data: string }[];
}

/**
 * Single client entry point for AI **authoring assistance** — Enhance, Generate
 * description, and the SQEM-035 setup-wizard generation.
 *
 * The deliberate chokepoint for SQEM-055 / SQEM-082: a BYOK `modelId` runs on the
 * workspace's own key; a null `modelId` (keyless) routes to the Sqemes-funded
 * model via `execute-step` and debits the workspace's monthly AI credits.
 */
export async function runAuthoringAI({
  workspaceId,
  modelId,
  systemInstruction,
  prompt,
  temperature = 1,
  attachments = [],
}: AuthoringAIParams): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-step`;
  const jobId = crypto.randomUUID();
  const resultPromise = waitForJobResult(jobId);

  // No BYOK model → route to Sqemes-funded credits (Cloud-only; server picks the model).
  const funded = !modelId;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    // Parts only when there is something to carry: a bare string is what every existing caller
    // sends and what every provider branch handles most cheaply.
    body: JSON.stringify({
      workspaceId,
      modelId: modelId ?? undefined,
      systemInstruction,
      promptContent: attachments.length
        ? [{ text: prompt }, ...attachments.map(a => ({ inlineData: { mimeType: a.mimeType, data: a.data } }))]
        : prompt,
      temperature,
      jobId,
      funded,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Edge function returned ${res.status}`);
  }

  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data?.result ?? await resultPromise;
}
