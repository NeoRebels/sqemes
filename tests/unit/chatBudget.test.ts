import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  budgetVerdict, budgetMessage, uuidFromSeed, personSeed, workspaceSeed,
  CHAT_RPM_PER_USER, CHAT_RPM_PER_WORKSPACE,
} from '../../supabase/functions/_shared/chatBudget';

/**
 * SQEM-501 — the chat/AI budget is per person, with a per-workspace ceiling. It was 60/min for the
 * whole workspace, which five people chatting non-stop already exhausted (SQEM-500 load test).
 */
describe('budgetVerdict', () => {
  it('both counters fine → ok', () => {
    expect(budgetVerdict(true, true)).toEqual({ ok: true });
  });
  it('the person\'s own limit is reported first — it is the one they can act on', () => {
    expect(budgetVerdict(false, false)).toMatchObject({ ok: false, scope: 'person' });
    expect(budgetVerdict(false, true)).toMatchObject({ ok: false, scope: 'person', limit: CHAT_RPM_PER_USER });
  });
  it('workspace ceiling reached → workspace', () => {
    expect(budgetVerdict(true, false)).toMatchObject({ ok: false, scope: 'workspace', limit: CHAT_RPM_PER_WORKSPACE });
  });
  it('defaults: 20 per person, 600 per workspace (= Business 30 seats × 20)', () => {
    expect(CHAT_RPM_PER_USER).toBe(20);
    expect(CHAT_RPM_PER_WORKSPACE).toBe(600);
  });
  it('the message names which budget ran out and that it resets', () => {
    expect(budgetMessage({ ok: false, scope: 'person', limit: 20 })).toMatch(/You have sent more than 20 .*60 seconds/);
    expect(budgetMessage({ ok: false, scope: 'workspace', limit: 600 })).toMatch(/This workspace .*600/);
  });
});

describe('counter keys', () => {
  it('two people in one workspace never share a bucket; the person and workspace keys differ', async () => {
    const a = await uuidFromSeed(personSeed('ws', 'u1'));
    const b = await uuidFromSeed(personSeed('ws', 'u2'));
    const w = await uuidFromSeed(workspaceSeed('ws'));
    expect(new Set([a, b, w]).size).toBe(3);
  });
  it('the same person in two workspaces has two budgets', async () => {
    expect(await uuidFromSeed(personSeed('ws1', 'u'))).not.toBe(await uuidFromSeed(personSeed('ws2', 'u')));
  });
  it('⛔ uuidFromSeed is unchanged by the move out of marketplace-vote (vote counters keep their keys)', async () => {
    // SHA-256("vote:test") — first 16 bytes, formatted as a UUID. Computed independently of the code.
    const { createHash } = await import('node:crypto');
    const h = createHash('sha256').update('vote:test').digest('hex').slice(0, 32);
    const expected = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    expect(await uuidFromSeed('vote:test')).toBe(expected);
  });
});

describe('wiring', () => {
  for (const f of ['supabase/functions/chat-message/index.ts', 'supabase/functions/execute-step/index.ts']) {
    it(`⛔ ${f} uses the per-person budget, not the workspace-wide one`, () => {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/checkChatBudget\(workspaceId, user\.id\)/);
      expect(src).not.toMatch(/checkRateLimit\(workspaceId\)/);
    });
  }
});
