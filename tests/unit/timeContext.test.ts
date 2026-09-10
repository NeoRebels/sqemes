import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { timeContextLine, withTimeContext } from '../../supabase/functions/_shared/timeContext';

/**
 * SQEM-370 — the model is told what day it is, and the interesting assertions are the ones about
 * *when* that is decided rather than what it says.
 */
const NOW = new Date('2026-09-10T16:15:00Z');

describe('timeContextLine', () => {
  it('formats the moment in the given zone', () => {
    const line = timeContextLine(NOW, 'Europe/Berlin')!;
    expect(line).toContain('Thursday');
    expect(line).toContain('10 September 2026');
    expect(line).toContain('18:15'); // 16:15 UTC in CEST
    expect(line).toContain('(Europe/Berlin)');
  });

  it('the same instant reads differently in another zone', () => {
    // The whole reason the zone travels with the request rather than being a workspace setting.
    const berlin = timeContextLine(NOW, 'Europe/Berlin')!;
    const auckland = timeContextLine(NOW, 'Pacific/Auckland')!;
    expect(auckland).not.toBe(berlin);
    expect(auckland).toContain('11 September 2026'); // already the next day there
  });

  it('spells the month out', () => {
    // ⚠️ A numeric locale would hand some models 09/10 and others 10/09 for the same day. `en-GB`
    // with a long month removes the ambiguity rather than betting on which way a model reads it.
    expect(timeContextLine(NOW, 'UTC')).toContain('September');
    expect(timeContextLine(NOW, 'UTC')).not.toMatch(/\b\d{2}\/\d{2}\//);
  });

  it('survives a malformed zone instead of failing the message', () => {
    // The value comes from a browser and is untrusted. `Intl` throws a RangeError on an unknown
    // identifier; a bad zone must cost the date line, never the user's message.
    expect(timeContextLine(NOW, 'Not/AZone')).toBeNull();
    expect(timeContextLine(NOW, '../../etc/passwd')).toBeNull();
    expect(timeContextLine(NOW, '')).toBeNull();
    expect(timeContextLine(NOW, undefined)).toBeNull();
  });
});

describe('withTimeContext', () => {
  it('applies with no assistant at all', () => {
    // ⭐ The assertion that matters most. `systemInstruction` is undefined in most sessions — no
    // assistant applied. Returning it unchanged there would have limited the feature to assistant
    // sessions, which is exactly where a naive implementation lands.
    const out = withTimeContext(undefined, NOW, 'Europe/Berlin');
    expect(out).toBeTruthy();
    expect(out).toContain('September');
  });

  it('goes in front of an existing instruction and keeps it whole', () => {
    const out = withTimeContext('You are a pirate.', NOW, 'Europe/Berlin')!;
    expect(out.endsWith('You are a pirate.')).toBe(true);
    expect(out.indexOf('September')).toBeLessThan(out.indexOf('pirate'));
  });

  it('changes nothing when there is no usable zone', () => {
    expect(withTimeContext('You are a pirate.', NOW, undefined)).toBe('You are a pirate.');
    expect(withTimeContext(undefined, NOW, 'Not/AZone')).toBeUndefined();
  });
});

describe('SQEM-370 — the date cannot go stale', () => {
  it('every entry point takes `now` as an argument', () => {
    // ⛔ This is the structural guard, and it is the whole design. A session left open overnight
    // must not keep yesterday's date, so there must be nowhere to cache one: no module-level
    // `Date.now()`, no `new Date()` inside the helpers.
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/timeContext.ts'), 'utf8',
    ).replace(/^[ \t]*\*.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/new Date\(/);
    expect(src).not.toMatch(/Date\.now\(/);
  });

  it('the edge function builds it per request, not per session', () => {
    // The counterpart: `chat-message` composes on every call, inside the request handler.
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/chat-message/index.ts'), 'utf8',
    );
    expect(src).toMatch(/withTimeContext\(systemInstruction, new Date\(\), timeZone\)/);
  });
});
