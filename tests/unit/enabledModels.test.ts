import { describe, it, expect } from 'vitest';
import { buildEnabledModels, FUNDED_MODEL_ID } from '../../lib/enabledModels';
import type { Workspace } from '../../types';

// SQEM-184 — which models a workspace can use; BYOK-must-win over the funded "Sqemes AI" option.
type Keys = Workspace['apiKeys'];

describe('buildEnabledModels', () => {
  it('returns only models whose provider has a saved key', () => {
    const models = buildEnabledModels({ gemini: 'k' } as Keys);
    expect(models.length).toBeGreaterThan(0);
    expect(models.every(m => m.provider === 'gemini')).toBe(true);
  });

  it('returns nothing for a keyless workspace (no funded option)', () => {
    expect(buildEnabledModels({} as Keys)).toEqual([]);
  });

  it('appends custom OpenRouter models (deduped) only with an openrouter key', () => {
    expect(buildEnabledModels({} as Keys, ['acme/model-x'])).toEqual([]); // no key → ignored
    const withKey = buildEnabledModels({ openrouter: 'k' } as Keys, ['acme/model-x', 'acme/model-x', ' ']);
    const custom = withKey.filter(m => m.provider === 'openrouter' && m.id === 'acme/model-x');
    expect(custom).toHaveLength(1); // deduped, blanks skipped
  });

  it('appends the funded "Sqemes AI" option only when keyless and funding is available', () => {
    const funded = buildEnabledModels({} as Keys, [], true);
    expect(funded.some(m => m.id === FUNDED_MODEL_ID)).toBe(true);
  });

  it('hides the funded option when a BYOK text model exists (BYOK wins)', () => {
    const withKey = buildEnabledModels({ gemini: 'k' } as Keys, [], true);
    expect(withKey.some(m => m.id === FUNDED_MODEL_ID)).toBe(false);
  });
});
