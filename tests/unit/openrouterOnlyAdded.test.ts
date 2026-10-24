import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/realtimeJob', () => ({ waitForJobResult: () => Promise.resolve('') }));

import { AVAILABLE_MODELS } from '../../constants';
import { buildEnabledModels } from '../../lib/enabledModels';
import { authoringModelState, firstTextModelId, providerOfModel } from '../../lib/authoringAI';

/**
 * SQEM-573 — OpenRouter has no built-in models: with a key saved, only the ids the workspace added
 * appear, and the authoring model can be one of them.
 */
describe('SQEM-573 — OpenRouter shows only added models', () => {
  it('⛔ the catalogue carries no OpenRouter model', () => {
    expect(AVAILABLE_MODELS.filter(m => m.provider === 'openrouter')).toEqual([]);
  });

  it('a key alone adds nothing to the picker', () => {
    expect(buildEnabledModels({ openrouter: 'k' }, [])).toEqual([]);
  });

  it('the added ids are exactly what appears', () => {
    expect(buildEnabledModels({ openrouter: 'k' }, ['acme/x', 'acme/y']).map(m => m.id)).toEqual(['acme/x', 'acme/y']);
  });

  it('⛔ an OpenRouter-only workspace still has an authoring model — its first added text id', () => {
    expect(firstTextModelId({ openrouter: 'k' }, ['acme/x-image', 'acme/writer'])).toBe('acme/writer');
    const s = authoringModelState({ apiKeys: { openrouter: 'k' }, authoringModelId: null, openrouterModels: ['acme/writer'] });
    expect(s).toMatchObject({ status: 'auto', effectiveId: 'acme/writer' });
  });

  it('an added id can be CHOSEN, not reported unavailable', () => {
    const s = authoringModelState({ apiKeys: { openrouter: 'k' }, authoringModelId: 'acme/b', openrouterModels: ['acme/a', 'acme/b'] });
    expect(s).toMatchObject({ status: 'chosen', effectiveId: 'acme/b' });
  });

  it('a removed default that is still stored falls back and says so', () => {
    const s = authoringModelState({ apiKeys: { openrouter: 'k' }, authoringModelId: 'deepseek/deepseek-v4-flash', openrouterModels: ['acme/a'] });
    expect(s).toMatchObject({ status: 'unavailable', effectiveId: 'acme/a' });
  });

  it('the provider of an added id is openrouter (it decides what an upload may be)', () => {
    expect(providerOfModel({ apiKeys: { openrouter: 'k' }, authoringModelId: null, openrouterModels: ['acme/a'] }, 'acme/a')).toBe('openrouter');
    expect(providerOfModel({ apiKeys: {}, authoringModelId: null }, null)).toBeNull();
  });
});
