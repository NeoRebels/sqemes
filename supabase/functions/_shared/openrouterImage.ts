// SQEM-574 — image models on OpenRouter.
//
// ⛔ Before this, every OpenRouter model went to the text path. An image model answered there with its
// picture in `message.images` and an empty `content`, so Chat showed nothing — only OpenRouter text
// models worked.
//
// OpenRouter has no images endpoint: an image model is called through `/chat/completions` with
// `modalities`, and the images come back as data URLs in `choices[0].message.images[].image_url.url`.
//
// ⚠️ **Which models generate images is read from OpenRouter, not guessed from the id.** The id pattern
// the rest of the app uses (`isImageModel`: "image", "dall-e", "aurora") misses most of OpenRouter's
// image models — seedream, krea, recraft, riverflow, flux-* variants. The public model list says it
// per model (`architecture.output_modalities`), needs no key, and is cached per function instance.
//
// The parse and shape functions are pure so tests/unit can import them.

import { fetchWithTimeout } from './fetchWithTimeout.ts';

export type OpenRouterImageModel = {
  /** Also answers in text (Gemini image models do) ⇒ `modalities: ['image','text']`; else `['image']`. */
  outputsText: boolean;
  /** Takes an image as input ⇒ the previous picture or an uploaded one can be edited. */
  acceptsImage: boolean;
};

/**
 * The image-generating models out of `/api/v1/models?output_modalities=image`.
 *
 * ⚠️ `openrouter/*` (the auto router) is left out on purpose: it lists image among its outputs, but
 * a person who picked it wants a chat model, and the image path has no streaming, no tools.
 */
export function parseImageModels(json: unknown): Map<string, OpenRouterImageModel> {
  const out = new Map<string, OpenRouterImageModel>();
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const m of data) {
    const id = typeof m?.id === 'string' ? m.id : '';
    const outputs: unknown = m?.architecture?.output_modalities;
    const inputs: unknown = m?.architecture?.input_modalities;
    if (!id || id.startsWith('openrouter/') || !Array.isArray(outputs) || !outputs.includes('image')) continue;
    out.set(id, { outputsText: outputs.includes('text'), acceptsImage: Array.isArray(inputs) && inputs.includes('image') });
  }
  return out;
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=image';
const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; models: Map<string, OpenRouterImageModel> } | null = null;

/**
 * Is this OpenRouter id an image model? Null ⇒ treat it as a text model.
 *
 * ⚠️ If the list cannot be fetched, the id pattern decides — the old behaviour for anything it
 * matches would have been a guaranteed empty answer, so guessing "image" there costs nothing.
 */
export async function openRouterImageModel(modelId: string): Promise<OpenRouterImageModel | null> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const res = await fetchWithTimeout(MODELS_URL, { method: 'GET' }, 10_000);
      if (res.ok) cache = { at: Date.now(), models: parseImageModels(await res.json()) };
    } catch (e) {
      console.warn('[openrouter-image] model list unavailable:', e instanceof Error ? e.message : String(e));
    }
  }
  if (cache) return cache.models.get(modelId) ?? null;
  return /image/i.test(modelId) ? { outputsText: /gemini/i.test(modelId), acceptsImage: true } : null;
}

/** The request body. `images` are data URLs (an upload, or the last generated picture to edit). */
export function openRouterImageBody(
  modelId: string,
  model: OpenRouterImageModel,
  prompt: string,
  images: string[] = [],
): Record<string, unknown> {
  const parts = model.acceptsImage && images.length
    ? [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
    : prompt;
  return {
    model: modelId,
    messages: [{ role: 'user', content: parts }],
    modalities: model.outputsText ? ['image', 'text'] : ['image'],
  };
}

/** The answer as Chat stores it: the model's text (if any), then every image as markdown. */
export function openRouterImageResult(data: any): string {
  if (data?.error) throw new Error(`OpenRouter API error: ${data.error.message ?? JSON.stringify(data.error)}`);
  const message = data?.choices?.[0]?.message ?? {};
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  const urls: string[] = (Array.isArray(message.images) ? message.images : [])
    .map((i: any) => i?.image_url?.url)
    .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0);
  if (!urls.length) return text || 'No image generated.';
  const pictures = urls.map(u => `![Generated Image](${u})`).join('\n\n');
  return text ? `${text}\n\n${pictures}` : pictures;
}

/** One call. Images take long — the default (image) timeout of `fetchWithTimeout` applies. */
export async function callOpenRouterImage(
  apiKey: string,
  modelId: string,
  model: OpenRouterImageModel,
  prompt: string,
  images: string[] = [],
): Promise<string> {
  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(openRouterImageBody(modelId, model, prompt, images)),
  });
  if (!response.ok) throw new Error(`OpenRouter API error (${response.status}): ${await response.text()}`);
  return openRouterImageResult(await response.json());
}
