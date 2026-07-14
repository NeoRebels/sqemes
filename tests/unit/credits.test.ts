import { describe, it, expect } from 'vitest';
import { isUnlimitedCredits, creditsRemaining, creditsUsagePercent, creditsTooltip } from '../../lib/credits';

describe('credit helpers', () => {
  it('treats limit 0 as unlimited', () => {
    expect(isUnlimitedCredits(0)).toBe(true);
    expect(isUnlimitedCredits(2000)).toBe(false);
    expect(creditsRemaining(500, 0)).toBe(Infinity);
    expect(creditsUsagePercent(500, 0)).toBe(0);
    expect(creditsTooltip(500, 0)).toBe('Unlimited AI credits');
  });

  it('computes remaining and percent, clamped', () => {
    expect(creditsRemaining(200, 2000)).toBe(1800);
    expect(creditsUsagePercent(500, 2000)).toBe(25);
    expect(creditsUsagePercent(2500, 2000)).toBe(100); // over-limit clamps to 100
    expect(creditsRemaining(2500, 2000)).toBe(0);       // and remaining clamps to 0
  });

  it('formats the tooltip', () => {
    expect(creditsTooltip(500, 5000)).toBe('4,500 / 5,000 credits left');
  });
});
