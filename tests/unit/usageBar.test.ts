import { describe, it, expect } from 'vitest';
import { formatStorage, usagePercent } from '../../components/ui/UsageBar';

/** SQEM-555 — the usage bar's arithmetic. */
describe('SQEM-555 — UsageBar', () => {
  it('unlimited draws no bar; a limit of 0 is full; values are clamped', () => {
    expect(usagePercent(5, null)).toBeNull();
    expect(usagePercent(0, 0)).toBe(100);
    expect(usagePercent(3, 10)).toBe(30);
    expect(usagePercent(20, 10)).toBe(100);
  });

  it('formats storage in KB, MB and GB', () => {
    expect(formatStorage(0)).toBe('0 MB');
    expect(formatStorage(2048)).toBe('2 KB');
    expect(formatStorage(5 * 1024 ** 2)).toBe('5 MB');
    expect(formatStorage(1024 ** 3)).toBe('1.0 GB');
    expect(formatStorage(50 * 1024 ** 3)).toBe('50 GB');
  });
});
