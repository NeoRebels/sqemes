import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseImageModels, openRouterImageBody, openRouterImageResult } from '../../supabase/functions/_shared/openrouterImage';

/** SQEM-574 — OpenRouter image models run through chat completions with `modalities`. */
const LIST = {
  data: [
    { id: 'google/gemini-3.1-flash-image', architecture: { output_modalities: ['image', 'text'], input_modalities: ['image', 'text'] } },
    { id: 'bytedance-seed/seedream-5-0-pro', architecture: { output_modalities: ['image'], input_modalities: ['text', 'image'] } },
    { id: 'recraft/recraft-v4.1-flash', architecture: { output_modalities: ['image'], input_modalities: ['text'] } },
    { id: 'openrouter/auto-beta', architecture: { output_modalities: ['text', 'image'], input_modalities: ['text', 'image'] } },
    { id: 'acme/text-only', architecture: { output_modalities: ['text'], input_modalities: ['text'] } },
  ],
};

describe('parseImageModels', () => {
  const m = parseImageModels(LIST);
  it('⭐ knows image models whose id says nothing about images', () => {
    expect(m.get('bytedance-seed/seedream-5-0-pro')).toEqual({ outputsText: false, acceptsImage: true });
    expect(m.get('recraft/recraft-v4.1-flash')).toEqual({ outputsText: false, acceptsImage: false });
  });
  it('a model that also writes text is marked so', () => {
    expect(m.get('google/gemini-3.1-flash-image')).toEqual({ outputsText: true, acceptsImage: true });
  });
  it('⛔ the auto router and text models stay on the text path', () => {
    expect(m.has('openrouter/auto-beta')).toBe(false);
    expect(m.has('acme/text-only')).toBe(false);
  });
  it('a broken answer yields an empty map, not a throw', () => {
    expect(parseImageModels(null).size).toBe(0);
    expect(parseImageModels({ data: 'x' }).size).toBe(0);
  });
});

describe('openRouterImageBody', () => {
  it('image-only models ask for image only (OpenRouter rejects text for them)', () => {
    expect(openRouterImageBody('a/b', { outputsText: false, acceptsImage: false }, 'a cat').modalities).toEqual(['image']);
  });
  it('image+text models ask for both', () => {
    expect(openRouterImageBody('a/b', { outputsText: true, acceptsImage: true }, 'a cat').modalities).toEqual(['image', 'text']);
  });
  it('an image to edit goes along only when the model accepts one', () => {
    const img = 'data:image/png;base64,AAAA';
    const yes = openRouterImageBody('a/b', { outputsText: false, acceptsImage: true }, 'bluer', [img]) as any;
    expect(yes.messages[0].content).toEqual([{ type: 'text', text: 'bluer' }, { type: 'image_url', image_url: { url: img } }]);
    const no = openRouterImageBody('a/b', { outputsText: false, acceptsImage: false }, 'bluer', [img]) as any;
    expect(no.messages[0].content).toBe('bluer');
  });
});

describe('openRouterImageResult', () => {
  const img = (url: string) => ({ type: 'image_url', image_url: { url } });
  it('⛔ the picture in message.images becomes markdown Chat renders and stores', () => {
    const r = openRouterImageResult({ choices: [{ message: { content: '', images: [img('data:image/png;base64,QUJD')] } }] });
    expect(r).toBe('![Generated Image](data:image/png;base64,QUJD)');
  });
  it('text first, then every image', () => {
    const r = openRouterImageResult({ choices: [{ message: { content: 'Here.', images: [img('data:image/png;base64,A'), img('data:image/jpeg;base64,B')] } }] });
    expect(r).toBe('Here.\n\n![Generated Image](data:image/png;base64,A)\n\n![Generated Image](data:image/jpeg;base64,B)');
  });
  it('no image says so instead of an empty answer', () => {
    expect(openRouterImageResult({ choices: [{ message: { content: '' } }] })).toBe('No image generated.');
    expect(openRouterImageResult({ choices: [{ message: { content: 'Refused.' } }] })).toBe('Refused.');
  });
  it('an error in a 200 body is an error', () => {
    expect(() => openRouterImageResult({ error: { message: 'No endpoints found' } })).toThrow('OpenRouter API error: No endpoints found');
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');
  for (const fn of ['chat-message', 'execute-step']) {
    it(`${fn}: the image branch runs before the text job`, () => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      const branch = src.indexOf("provider === 'openrouter' ? await openRouterImageModel(");
      expect(branch).toBeGreaterThan(-1);
      expect(branch).toBeLessThan(src.indexOf('EdgeRuntime.waitUntil(runAndBroadcast('));
    });
  }
});
