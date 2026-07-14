import { AVAILABLE_MODELS } from '../constants';
import type { Workspace } from '../types';

export type EnabledModel = {
  id: string;
  name: string;
  description?: string;
  provider: string;
  specs?: { description: string; cost: number; speed: number; thinking: number };
};

// SQEM-082 — sentinel id for the Sqemes-funded (keyless, credit-metered) option.
// When selected, call sites send `funded: true` instead of a real modelId. This id
// is also what's stored/shown as the model on funded chat replies.
export const FUNDED_MODEL_ID = 'sqemes-ai-model';

const IMAGE_MODEL_PATTERNS = ['image', 'dall-e', 'aurora'];
const isImageModel = (id: string) => IMAGE_MODEL_PATTERNS.some(p => id.toLowerCase().includes(p));

export const isFundedModel = (id: string | undefined): boolean => id === FUNDED_MODEL_ID;

// SQEM-031 — models a workspace can actually use: catalog models whose provider
// has a saved key, plus any user-pasted OpenRouter model ids (only when an
// OpenRouter key exists). Shared by Chat, the editor test panel, and authoring AI.
//
// SQEM-082 — when the workspace is keyless (no BYOK *text* model) and Sqemes-funded
// AI is available (Cloud), append a single "Sqemes AI" option that runs on credits.
// BYOK takes precedence: the funded option is hidden whenever a text key exists.
export function buildEnabledModels(
  apiKeys: Workspace['apiKeys'],
  openrouterModels: string[] = [],
  fundedAvailable = false,
): EnabledModel[] {
  const enabled: EnabledModel[] = AVAILABLE_MODELS.filter(m => {
    const key = apiKeys[m.provider as keyof typeof apiKeys];
    return !!key && key.length > 0;
  });

  if (apiKeys.openrouter && apiKeys.openrouter.length > 0) {
    const seen = new Set(enabled.map(m => m.id));
    for (const raw of openrouterModels) {
      const id = raw.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      enabled.push({ id, name: id, description: 'Custom OpenRouter model', provider: 'openrouter' });
    }
  }

  const hasTextModel = enabled.some(m => !isImageModel(m.id));
  if (fundedAvailable && !hasTextModel) {
    enabled.push({ id: FUNDED_MODEL_ID, name: 'Sqemes AI', description: 'Uses your monthly AI credits — no API key needed', provider: 'sqemes' });
  }
  return enabled;
}
