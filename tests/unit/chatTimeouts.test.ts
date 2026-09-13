import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EDGE_WALL_CLOCK_MS, EDGE_PLAN_IS_PAID, PROVIDER_TIMEOUT_MS, CLIENT_JOB_TIMEOUT_MS,
  providerTimeoutMs, clientJobTimeoutMs, type TimeoutContext,
} from '../../supabase/functions/_shared/chatTimeouts';

/**
 * SQEM-381 — the chat timeout chain, and the two orderings that must never flip.
 *
 * ⛔ Written because the previous numbers were reasoned about from a platform limit that was never
 * checked (150 s is free-tier; paid is 400 s). The invariants below are what the numbers have to
 * satisfy under BOTH plans; the flag decides which world is live, and the tests exercise both so a
 * flip can never break an ordering silently. (The flag pointed the wrong way for one promotion — a
 * misread reply, not a plan change; see the pin test below.)
 */
const root = (p: string) => resolve(__dirname, '../../', p);
const code = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

const CLOUD_PLAIN      = { connectors: false, selfHosted: false };
const CLOUD_CONNECTORS = { connectors: true,  selfHosted: false };
const HOST_PLAIN       = { connectors: false, selfHosted: true };
const HOST_CONNECTORS  = { connectors: true,  selfHosted: true };
const ALL = [CLOUD_PLAIN, CLOUD_CONNECTORS, HOST_PLAIN, HOST_CONNECTORS];
// ⚠️ Typed as `TimeoutContext`, not `object`: spreading `object` erases the shape, vitest (esbuild)
// does not care, and `tsc` — which CI runs — rejects every call. Caught locally before push.
const paid = (ctx: TimeoutContext): TimeoutContext => ({ ...ctx, paidPlan: true });
const free = (ctx: TimeoutContext): TimeoutContext => ({ ...ctx, paidPlan: false });

describe('SQEM-381 — the orderings, under both plans', () => {
  it('⛔ the client always outlasts the provider call', () => {
    // If the client gives up first, the honest 504 the server produces a moment later arrives at
    // nobody, and the user sees "took too long" instead of "the provider did not respond".
    for (const ctx of ALL) {
      for (const world of [free(ctx), paid(ctx)]) {
        expect(clientJobTimeoutMs(world), JSON.stringify(world)).toBeGreaterThan(providerTimeoutMs(world));
      }
    }
  });

  it('⛔ under a FREE wall clock, no provider call may exceed it — in ANY context', () => {
    // A killed worker broadcasts nothing — no result, no error. A 300 s provider timeout on a
    // 150 s worker does not buy the model time; it turns an honest 504 into silence. This is the
    // direction the module must never take by accident.
    for (const ctx of ALL) {
      expect(providerTimeoutMs(free(ctx)), JSON.stringify(ctx)).toBeLessThan(EDGE_WALL_CLOCK_MS.free);
    }
  });

  it('⛔ under a PAID wall clock, both fit under it — in ANY context', () => {
    for (const ctx of ALL) {
      expect(providerTimeoutMs(paid(ctx))).toBeLessThan(EDGE_WALL_CLOCK_MS.paid);
      expect(clientJobTimeoutMs(paid(ctx))).toBeLessThan(EDGE_WALL_CLOCK_MS.paid);
    }
  });

  it('⭐ the long pair is earned: connectors AND paid AND not self-host', () => {
    // With `mcp_servers` every remote tool call runs inside ONE provider request, so each extra
    // connector packs more round trips into the same budget — but only a paid wall clock can hold
    // the longer pair.
    expect(providerTimeoutMs(paid(CLOUD_CONNECTORS))).toBe(PROVIDER_TIMEOUT_MS.connectors);
    expect(clientJobTimeoutMs(paid(CLOUD_CONNECTORS))).toBe(CLIENT_JOB_TIMEOUT_MS.connectors);
    expect(PROVIDER_TIMEOUT_MS.connectors).toBeGreaterThan(PROVIDER_TIMEOUT_MS.default);
    // Any one leg missing → default pair.
    expect(providerTimeoutMs(free(CLOUD_CONNECTORS))).toBe(PROVIDER_TIMEOUT_MS.default);
    expect(providerTimeoutMs(paid(CLOUD_PLAIN))).toBe(PROVIDER_TIMEOUT_MS.default);
    expect(providerTimeoutMs(paid(HOST_CONNECTORS))).toBe(PROVIDER_TIMEOUT_MS.default);
  });

  it('⛔ the flag is ON — Cloud production is on a paid plan (owner, 2026-09-11: "no free plan at all")', () => {
    // Nothing in code can read the plan. This pins the operator's statement, so a change to it is a
    // deliberate edit that fails a test rather than a silent assumption. ⚠️ It was `false` for one
    // promotion because a reply was misread — the connector fix the owner had approved was withheld
    // on production for that window. The quote in the title is what a pin should rest on.
    expect(EDGE_PLAN_IS_PAID).toBe(true);
    // …and therefore the live default gives Cloud connector turns the long pair, and nobody else.
    expect(providerTimeoutMs(CLOUD_CONNECTORS)).toBe(PROVIDER_TIMEOUT_MS.connectors);
    expect(providerTimeoutMs(CLOUD_PLAIN)).toBe(PROVIDER_TIMEOUT_MS.default);
    expect(providerTimeoutMs(HOST_CONNECTORS)).toBe(PROVIDER_TIMEOUT_MS.default);
  });

  it('⚠️ known gap under a FREE wall clock (self-host may be one): the default client outlasts the worker', () => {
    // 180 s > 150 s. A streamed call whose body stalls past 150 s dies with the worker and the
    // client only learns at 180 s. Tightening the client to <150 s would cut every plain turn that
    // legitimately needs 140–180 s (SQEM-373 tool loops), so it is left as is and stated here.
    expect(clientJobTimeoutMs(free(HOST_PLAIN))).toBeGreaterThan(EDGE_WALL_CLOCK_MS.free);
  });

  it('the plain pair is unchanged from before SQEM-381', () => {
    // Image generation, authoring and ordinary chat turns keep the numbers they always had.
    expect(providerTimeoutMs(CLOUD_PLAIN)).toBe(120_000);
    expect(clientJobTimeoutMs(CLOUD_PLAIN)).toBe(180_000);
  });
});

describe('SQEM-381 — both ends read the SAME module', () => {
  // ⛔ The rule "extend the timeouts when connectors are active" has to give the same answer on the
  // server and in the browser. Two hand-maintained copies is how it stops doing that.
  const CHAT_FN  = code(readFileSync(root('supabase/functions/chat-message/index.ts'), 'utf8'));
  const CLIENT   = code(readFileSync(root('lib/realtimeJob.ts'), 'utf8'));
  const CHAT_TSX = code(readFileSync(root('pages/Chat.tsx'), 'utf8'));
  const FETCH    = readFileSync(root('supabase/functions/_shared/fetchWithTimeout.ts'), 'utf8');

  it('the edge function passes the provider timeout on BOTH connector-capable paths', () => {
    // Claude (Messages API) and OpenAI (Responses) are the two that carry `mcp_servers`.
    expect([...CHAT_FN.matchAll(/providerTimeoutMs\(/g)].length).toBeGreaterThanOrEqual(2);
    expect(CHAT_FN).toMatch(/from '\.\.\/_shared\/chatTimeouts\.ts'/);
  });

  it('the browser derives its job timeout from the same module', () => {
    expect(CLIENT).toMatch(/CLIENT_JOB_TIMEOUT_MS/);
    expect(CLIENT).not.toMatch(/JOB_TIMEOUT_MS = 180_000/);
    expect(CHAT_TSX).toMatch(/clientJobTimeoutMs\(/);
  });

  it('⚠️ the 504 message states the timeout that actually applied', () => {
    // It used to hardcode "120 seconds". With two possible values that would have lied on the path
    // that matters most.
    expect(FETCH).not.toMatch(/within 120 seconds/);
    expect(FETCH).toMatch(/timeoutMs \/ 1000/);
  });

  it('⛔ nothing still claims a 150 s edge-function limit as THE limit', () => {
    // Seven places did. It is the free-plan number; production is paid. Anything that reasons from
    // 150 s reasons from the wrong ceiling.
    for (const file of [
      'lib/realtimeJob.ts',
      'supabase/functions/chat-message/index.ts',
      'supabase/functions/_shared/libraryTools.ts',
    ]) {
      const src = readFileSync(root(file), 'utf8');
      expect(src, file).not.toMatch(/~150 s|the 150 s edge function limit/);
    }
  });
});
