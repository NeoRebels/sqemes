import { describe, it, expect, vi } from 'vitest';

// `authoringAI.ts` imports the Supabase client at module load; the resolver under test never touches
// it, but the import would throw without env vars.
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/realtimeJob', () => ({ waitForJobResult: () => Promise.resolve('') }));

import { authoringModelState, authoringModelId } from '../../lib/authoringAI';
import { AVAILABLE_MODELS } from '../../constants';
import { isImageModel } from '../../lib/enabledModels';

const textModels = AVAILABLE_MODELS.filter(m => !isImageModel(m.id));
const gemini = textModels.find(m => m.provider === 'gemini')!;
const openai = textModels.find(m => m.provider === 'openai')!;

const ws = (apiKeys: Record<string, string>, authoringModelId: string | null = null) =>
  ({ apiKeys, authoringModelId } as any);

describe('authoringModelState', () => {
  it('falls back to the first text model when nothing was chosen', () => {
    const s = authoringModelState(ws({ gemini: '••••', openai: '••••' }));
    expect(s.status).toBe('auto');
    expect(s.effectiveId).toBe(textModels[0].id);
  });

  it('uses the chosen model when its provider still has a key', () => {
    const s = authoringModelState(ws({ gemini: '••••', openai: '••••' }, openai.id));
    expect(s.status).toBe('chosen');
    expect(s.effectiveId).toBe(openai.id);
  });

  // ⛔ The three cases this whole resolver exists for. From outside they are indistinguishable —
  // "it just used something else" — which is exactly why each is asserted rather than assumed.

  it('a model no longer in the catalogue falls back AND says so', () => {
    const s = authoringModelState(ws({ gemini: '••••' }, 'gpt-4-turbo-retired-2024'));
    expect(s.status).toBe('unavailable');
    expect(s.effectiveId).toBe(gemini.id);
    expect(s.chosenId).toBe('gpt-4-turbo-retired-2024');   // kept, so the UI can name it
  });

  it('a chosen model whose key was deleted falls back AND says so', () => {
    const s = authoringModelState(ws({ gemini: '••••' }, openai.id));
    expect(s.status).toBe('unavailable');
    expect(s.effectiveId).toBe(gemini.id);
  });

  it('no key at all yields null, so the caller routes to funded credits', () => {
    const s = authoringModelState(ws({}, openai.id));
    expect(s.status).toBe('none');
    expect(s.effectiveId).toBeNull();
    expect(authoringModelId(ws({}))).toBeNull();
  });

  // An image model can be stored only by editing the database by hand, but the resolver is the
  // last thing between a stored string and a request — it does not get to assume good input.
  it('never returns an image model', () => {
    const image = AVAILABLE_MODELS.find(m => isImageModel(m.id));
    if (!image) return;
    const s = authoringModelState(ws({ [image.provider]: '••••', gemini: '••••' }, image.id));
    expect(s.status).toBe('unavailable');
    expect(isImageModel(s.effectiveId!)).toBe(false);
  });
});
