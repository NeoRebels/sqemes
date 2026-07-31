import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hasActiveSubscription, isTrialing, needsSubscriptionGate, isPaymentFailing, trialDaysLeft,
} from '../../lib/subscription';
import type { Workspace } from '../../types';

// SQEM-184 — the Cloud paywall gate. WsLike = { isManaged, subscriptionStatus, trialEndsAt }.
type Ws = Pick<Workspace, 'isManaged' | 'subscriptionStatus' | 'trialEndsAt'>;
const ws = (o: Partial<Ws>): Ws => ({ isManaged: false, subscriptionStatus: null, trialEndsAt: null, ...o } as Ws);

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('hasActiveSubscription / isTrialing', () => {
  it('managed is always active', () => expect(hasActiveSubscription(ws({ isManaged: true }))).toBe(true));
  it('active / trialing count as active', () => {
    expect(hasActiveSubscription(ws({ subscriptionStatus: 'active' }))).toBe(true);
    expect(hasActiveSubscription(ws({ subscriptionStatus: 'trialing' }))).toBe(true);
  });
  it('null / canceled are not active', () => {
    expect(hasActiveSubscription(ws({ subscriptionStatus: null }))).toBe(false);
    expect(hasActiveSubscription(ws({ subscriptionStatus: 'canceled' }))).toBe(false);
  });
  it('isTrialing is true only for trialing', () => {
    expect(isTrialing(ws({ subscriptionStatus: 'trialing' }))).toBe(true);
    expect(isTrialing(ws({ subscriptionStatus: 'active' }))).toBe(false);
  });
});

describe('needsSubscriptionGate', () => {
  it('gates a never-subscribed, non-managed workspace', () => {
    expect(needsSubscriptionGate(ws({ subscriptionStatus: null }))).toBe(true);
  });
  it('gates lapsed states (canceled / past_due)', () => {
    expect(needsSubscriptionGate(ws({ subscriptionStatus: 'canceled' }))).toBe(true);
    expect(needsSubscriptionGate(ws({ subscriptionStatus: 'past_due' }))).toBe(true);
  });
  it('does not gate managed / active / trialing', () => {
    expect(needsSubscriptionGate(ws({ isManaged: true }))).toBe(false);
    expect(needsSubscriptionGate(ws({ subscriptionStatus: 'active' }))).toBe(false);
    expect(needsSubscriptionGate(ws({ subscriptionStatus: 'trialing' }))).toBe(false);
  });
  it('is disabled entirely on self-host (VITE_SELF_HOSTED=true)', () => {
    vi.stubEnv('VITE_SELF_HOSTED', 'true');
    expect(needsSubscriptionGate(ws({ subscriptionStatus: null }))).toBe(false);
  });
});

describe('isPaymentFailing', () => {
  it('is true for past_due / unpaid, false otherwise', () => {
    expect(isPaymentFailing(ws({ subscriptionStatus: 'past_due' }))).toBe(true);
    expect(isPaymentFailing(ws({ subscriptionStatus: 'unpaid' }))).toBe(true);
    expect(isPaymentFailing(ws({ subscriptionStatus: 'active' }))).toBe(false);
  });
});

describe('trialDaysLeft', () => {
  it('rounds a future trial end up to whole days', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const end = new Date('2026-01-03T12:00:00Z').toISOString(); // 2.5 days
    expect(trialDaysLeft(ws({ subscriptionStatus: 'trialing', trialEndsAt: end }))).toBe(3);
  });
  it('is 0 for a past trial end and null when not trialing', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-10T00:00:00Z'));
    expect(trialDaysLeft(ws({ subscriptionStatus: 'trialing', trialEndsAt: '2026-01-01T00:00:00Z' }))).toBe(0);
    expect(trialDaysLeft(ws({ subscriptionStatus: 'active', trialEndsAt: '2026-02-01T00:00:00Z' }))).toBeNull();
  });
});
