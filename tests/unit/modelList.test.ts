import { describe, it, expect } from 'vitest';
import { AVAILABLE_MODELS } from '../../constants';
import { isImageModel } from '../../lib/enabledModels';
import { imageGenEndpoint, canEditPreviousImage } from '../../supabase/functions/_shared/imageModels';

/**
 * SQEM-560 — the model list, checked against each provider's own documentation on 2026-10-22, and the
 * one place where a list refresh used to break something silently: image routing.
 */
const ids = AVAILABLE_MODELS.map(m => m.id);

describe('SQEM-560 — current model ids', () => {
  it('carries the current ids per provider', () => {
    for (const id of [
      'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4-argon',
      'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-image-2.5-sunburst',
      'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
      'grok-4.7', 'deepseek-flash', 'deepseek-v4-pro',
      'mistral-large-latest', 'mistral-small-latest', 'codestral-latest',
    ]) expect(ids, id).toContain(id);
  });

  it('no longer offers the superseded ones', () => {
    for (const id of [
      'gemini-3.7-flash', 'gemini-3.1-pro-preview', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-image-2',
      'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'grok-4.6', 'deepseek-v4-flash',
    ]) expect(ids, id).not.toContain(id);
  });

  it('one entry per job — no id twice', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('Mistral aliases carry no version in their label (the docs do not say which version they resolve to)', () => {
    for (const m of AVAILABLE_MODELS.filter(x => x.provider === 'mistral')) {
      expect(m.name, m.id).not.toMatch(/\d/);
    }
  });
});

describe('SQEM-560 — every image model reaches an image endpoint', () => {
  it('⛔ each non-Gemini image model in the list has an images endpoint (SQEM-275 broke this silently)', () => {
    const imageModels = AVAILABLE_MODELS.filter(m => isImageModel(m.id) && m.provider !== 'gemini' && m.provider !== 'openrouter');
    expect(imageModels.length).toBeGreaterThan(0);
    for (const m of imageModels) expect(imageGenEndpoint(m.id), m.id).not.toBeNull();
  });

  it('routes by prefix, so the next rename keeps working', () => {
    expect(imageGenEndpoint('gpt-image-2.5-sunburst')).toBe('https://api.openai.com/v1/images/generations');
    expect(imageGenEndpoint('gpt-image-3')).toBe('https://api.openai.com/v1/images/generations');
    expect(imageGenEndpoint('grok-imagine-image-2.0')).toBe('https://api.x.ai/v1/images/generations');
    expect(imageGenEndpoint('dall-e-3')).toBe('https://api.openai.com/v1/images/generations');
  });

  it('text models and Gemini image models are not images-API models', () => {
    for (const id of ['gpt-6-astra', 'claude-opus-5-5', 'grok-4.7', 'gemini-3-pro-image', 'gemini-3.1-flash-image']) {
      expect(imageGenEndpoint(id), id).toBeNull();
    }
  });

  it('only OpenAI GPT image models edit the previous image', () => {
    expect(canEditPreviousImage('gpt-image-2.5-sunburst')).toBe(true);
    expect(canEditPreviousImage('grok-imagine-image-2.0')).toBe(false);
    expect(canEditPreviousImage('dall-e-3')).toBe(false);
  });
});
