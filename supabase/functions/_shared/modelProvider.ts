/**
 * SQEM-678 — which provider a BYOK model id belongs to, read from the id itself. Moved here from
 * `chat-message` so `routine-run` decides the same way before a run starts (is there a key for it?).
 *
 * ⛔ The server keeps no model catalogue (that lives in the frontend's `constants.ts`); the id's shape is
 * all it has. `null` = no provider recognised — chat-message refuses such an id as unsupported.
 *
 * Deliberately free of imports, so tests/unit reach it.
 */
export function providerOfModelId(modelId: string): string | null {
  const id = modelId.toLowerCase();
  // OpenRouter model ids are `vendor/model` — none of the direct providers use a slash.
  if (id.includes('/')) return 'openrouter';
  if (id.startsWith('gpt-') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('dall-e')) return 'openai';
  if (id.includes('gemini') || id.includes('veo')) return 'gemini';
  if (id.includes('claude')) return 'claude';
  if (id.includes('grok')) return 'grok';
  if (id.includes('deepseek')) return 'deepseek';
  if (id.includes('mistral') || id.includes('codestral') || id.includes('ministral') || id.includes('magistral') || id.includes('pixtral')) return 'mistral';
  return null;
}
