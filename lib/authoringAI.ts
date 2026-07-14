import { supabase } from './supabase';
import { waitForJobResult } from './realtimeJob';
import { AVAILABLE_MODELS } from '../constants';

const IMAGE_MODEL_PATTERNS = ['image', 'dall-e', 'aurora'];

/**
 * First enabled *text* (non-image) model id for the workspace's configured keys,
 * or null when no provider key is set. Mirrors the selection used by Enhance.
 */
export function firstTextModelId(apiKeys: Record<string, string | undefined>): string | null {
  const enabled = AVAILABLE_MODELS.filter(m => {
    const key = apiKeys[m.provider];
    return key && key.length > 0;
  });
  const textModel = enabled.find(m => !IMAGE_MODEL_PATTERNS.some(p => m.id.toLowerCase().includes(p)));
  return textModel?.id ?? null;
}

export interface AuthoringAIParams {
  workspaceId: string;
  /** BYOK model id, or `null`/`undefined` to route to Sqemes-funded credits (keyless). */
  modelId: string | null;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
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
    body: JSON.stringify({ workspaceId, modelId: modelId ?? undefined, systemInstruction, promptContent: prompt, temperature, jobId, funded }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Edge function returned ${res.status}`);
  }

  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data?.result ?? await resultPromise;
}
