import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOB_EVENTS, jobEventFor } from '../../supabase/functions/_shared/jobEvents';

/**
 * SQEM-374 — the contract between the broadcast sender and the client listener.
 *
 * ⛔ **This file exists because two green tests hid a total outage.** `chatStreaming.test.ts`
 * asserted that the client listens for `event: 'delta'` and that `chat-message` broadcasts
 * `{ delta: text }`. Both were true. Nothing checked that the SENDER could emit that event at all —
 * `broadcast.ts` hardcoded `event: 'result'`, so every delta arrived as a result, the client resolved
 * with `payload.result` (undefined → `''`) on the first one and tore the channel down. Every streamed
 * chat answer was an empty bubble, on production, with no error anywhere.
 *
 * ⚠️ **The lesson is about the shape of the test, not the bug.** A source assertion can only see one
 * file. A contract that lives *between* two files needs an assertion that reads both — otherwise each
 * side passes on its own and the gap between them is invisible.
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const CLIENT    = readFileSync(root('lib/realtimeJob.ts'), 'utf8');
const BROADCAST = readFileSync(root('supabase/functions/_shared/broadcast.ts'), 'utf8');

describe('jobEventFor — which event a payload goes out under', () => {
  it('⛔ a delta payload is a DELTA, not a result', () => {
    // The whole outage in one assertion.
    expect(jobEventFor({ delta: 'Hel' })).toBe('delta');
  });

  it('a result and an error are both terminal', () => {
    expect(jobEventFor({ result: 'done' })).toBe('result');
    expect(jobEventFor({ error: 'boom' })).toBe('result');
  });

  it('⚠️ an empty delta still counts as a delta — the KEY decides, not the value', () => {
    // A payload carrying the key `delta` is a delta even when the string is empty. Deciding on
    // truthiness would send an empty delta out as a result and re-create the bug in miniature.
    expect(jobEventFor({ delta: '' })).toBe('delta');
  });

  it('an unknown payload is treated as terminal', () => {
    // Fail-safe direction: a terminal message that arrives too early is visible; a delta that never
    // arrives is not.
    expect(jobEventFor({})).toBe('result');
  });
});

describe('⛔ the contract — sender and client must use the same words', () => {
  it('the client listens for EVERY event the sender can emit', () => {
    // ⭐ This is the assertion that was missing. Adding a third event to `JOB_EVENTS` without a
    // listener in `lib/realtimeJob.ts` now fails here instead of in production.
    for (const event of JOB_EVENTS) {
      expect(CLIENT, `lib/realtimeJob.ts has no listener for '${event}'`)
        .toMatch(new RegExp(`\\{\\s*event:\\s*'${event}'\\s*\\}`));
    }
  });

  it('the client listens for NOTHING the sender cannot emit', () => {
    // The other direction, and it is not symmetric noise: a listener for an event that is never sent
    // reads as working code and is dead. That is how a wrong name survives a review.
    const listened = [...CLIENT.matchAll(/on\('broadcast',\s*\{\s*event:\s*'([a-z]+)'/g)].map(m => m[1]);
    expect(listened.length).toBeGreaterThan(0);
    expect([...new Set(listened)].sort()).toEqual([...JOB_EVENTS].sort());
  });

  it('⛔ broadcast.ts does NOT hardcode an event name any more', () => {
    // The literal is what broke it. `jobEventFor` is the only thing allowed to decide.
    expect(BROADCAST).toMatch(/event:\s*jobEventFor\(payload\)/);
    expect(BROADCAST).not.toMatch(/event:\s*'(delta|result)'/);
  });
});
