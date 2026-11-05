import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { describeContextOverflow, describeAIError } from '../../lib/aiErrors';
import { en, de } from './i18nText';

// SQEM-634 — the two errors exactly as a user saw them on 29.10.
const claude = 'Claude API error (400): {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 1012345 tokens > 1000000 maximum"},"request_id":"req_example"}';
const openai = 'OpenAI API error (stream): Your input exceeds the context window of this model. Please adjust your input and try again.';

describe('SQEM-634 — a request too large for the model is said so, with the way out', () => {
  it('Claude: names the provider, keeps its sentence, says to narrow the request (SQEM-651: no switch left to name)', () => {
    const out = describeContextOverflow(new Error(claude))!;
    expect(out.startsWith('The request is too large for Claude.')).toBe(true);
    expect(out).toContain('prompt is too long: 1012345 tokens > 1000000 maximum');
    expect(out).not.toContain('request_id'); // the sentence, not the JSON around it
    expect(out).toContain('narrow the request');
    expect(out).not.toContain('plug icon'); // SQEM-651 — the switches are gone
  });

  it('OpenAI stream error (no status code) is recognised too', () => {
    const out = describeContextOverflow(new Error(openai))!;
    expect(out.startsWith('The request is too large for OpenAI.')).toBe(true);
    expect(out).toContain('Your input exceeds the context window of this model.');
  });

  it('OpenAI-compatible wordings', () => {
    expect(describeContextOverflow('Mistral API error (400): {"message":"maximum context length is 128000 tokens"}')).toContain('Mistral');
    expect(describeContextOverflow('OpenAI API error (400): {"error":{"code":"context_length_exceeded","message":"too long"}}')).toContain('OpenAI');
  });

  it('⛔ anything else is left alone — the caller shows its own message', () => {
    expect(describeContextOverflow(new Error('Gemini API error (503): {"error":{"message":"busy"}}'))).toBeNull();
    expect(describeContextOverflow(new Error('Claude API error (400): mcp_servers: invalid url'))).toBeNull();
    expect(describeContextOverflow(new Error('Failed to fetch'))).toBeNull();
    expect(describeContextOverflow(undefined)).toBeNull();
  });

  it('describeAIError is unchanged by the split', () => {
    expect(describeAIError(new Error('Gemini API error (503): {"error":{"message":"busy"}}'), 'f')).toContain('busy');
  });

  it('the chat uses it, falling back to the raw message', () => {
    expect(readFileSync('pages/Chat.tsx', 'utf8')).toMatch(/setError\(describeContextOverflow\(err\) \?\? err\.message\)/);
  });

  it('both languages', () => {
    for (const k of ['aierr_too_large', 'aierr_too_large_next'] as const) {
      expect(en[k], k).toBeTruthy();
      expect(de[k], k).toBeTruthy();
    }
    expect(de.aierr_too_large_next).toContain('Grenze die Abfrage ein');
    expect(de.aierr_too_large_next).not.toContain('Stecker-Symbol');
  });
});
