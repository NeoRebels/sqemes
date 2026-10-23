// SQEM-560 — which image model goes to which images endpoint, by PREFIX rather than by exact id.
//
// ⛔ Why a prefix: SQEM-275 renamed `gpt-image-1` to `gpt-image-2` (and `grok-imagine-image` to
// `grok-imagine-image-2.0`) in the model list, while both edge functions kept an exact-id map that
// knew only the old names. From 2026-08-26 the new image models were sent to the TEXT API and failed.
// A provider renames its image model every few months; the endpoint does not change.
//
// Gemini image models are not here: they run through generateContent like the text models
// (`isGeminiImageModel` in chat-message).
//
// Pure — no Deno APIs, no network — so tests/unit can import it directly.

const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations';
const XAI_IMAGES = 'https://api.x.ai/v1/images/generations';

/** The images endpoint for this model, or null when it is not an images-API model. */
export function imageGenEndpoint(modelId: string): string | null {
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt-image') || id.startsWith('dall-e')) return OPENAI_IMAGES;
  if (id.startsWith('grok-imagine-image')) return XAI_IMAGES;
  return null;
}

/** OpenAI's GPT image models can edit the previous image; DALL·E and xAI cannot. */
export function canEditPreviousImage(modelId: string): boolean {
  return modelId.toLowerCase().startsWith('gpt-image');
}
