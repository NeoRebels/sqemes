import { describe, it, expect } from 'vitest';
import { describeAIError } from '../../lib/aiErrors';

const gemini503 = new Error(
  'Gemini API error (503): { "error": { "code": 503, "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", "status": "UNAVAILABLE" } }',
);

describe('describeAIError', () => {
  // ⛔ The invariant that matters most. SQEM-273 lost hours to a message that swallowed what the
  // provider said; this function exists to frame that sentence, never to replace it.
  it('keeps the provider’s own sentence verbatim', () => {
    expect(describeAIError(gemini503, 'fallback')).toContain(
      'This model is currently experiencing high demand',
    );
    expect(describeAIError(gemini503, 'fallback')).toContain('Please try again later');
  });

  it('says who and what it means, not just the code', () => {
    const out = describeAIError(gemini503, 'fallback');
    expect(out).toContain('Gemini');
    expect(out).toContain('busy right now');
    expect(out).not.toContain('UNAVAILABLE');   // the protocol word helps nobody
    expect(out).not.toContain('{');             // no JSON in front of a person
  });

  it.each([
    [429, 'busy right now'],
    [503, 'busy right now'],
    [401, 'refused the key'],
    [403, 'refused the key'],
    [404, 'does not know this model'],
    [500, 'had a problem'],
  ])('translates %i', (status, expected) => {
    expect(describeAIError(new Error(`OpenAI API error (${status}): {"error":{"message":"nope"}}`), 'f'))
      .toContain(expected);
  });

  // ⛔ SQEM-310 — the owner asked whether the model can even be chosen. It cannot: authoring flows
  // take `firstTextModelId()`, the first model with a key. An instruction to do something the
  // product does not offer sends a person hunting for a control that was never built.
  it('never tells anyone to pick a model, because they cannot', () => {
    for (const status of [429, 503, 404, 500, 401]) {
      const out = describeAIError(new Error(`Gemini API error (${status}): {"error":{"message":"x"}}`), 'f');
      expect(out).not.toMatch(/pick (a |another )?(different )?model/i);
      expect(out).not.toMatch(/choose a model/i);
    }
  });

  it('gives a next step for the cases where there is one', () => {
    expect(describeAIError(new Error('Claude API error (401): {"error":{"message":"bad key"}}'), 'f'))
      .toContain('Check the API key');
  });

  // ⚠️ A caller must never end up showing *less* than it would have without this.
  it('passes anything that is not a provider error straight through', () => {
    expect(describeAIError(new Error('Not authenticated'), 'fallback')).toBe('Not authenticated');
  });

  it('falls back only when there is nothing to show', () => {
    expect(describeAIError(null, 'fallback')).toBe('fallback');
    expect(describeAIError({}, 'fallback')).toBe('fallback');
  });

  it('survives a body that is not JSON', () => {
    expect(describeAIError(new Error('Gemini API error (503): upstream connect error'), 'f'))
      .toContain('upstream connect error');
  });
});
