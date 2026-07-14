import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// monitoring.ts uses window.addEventListener which exists in jsdom
const { initMonitoring, logError, setMonitoringUser, clearMonitoringUser } = await import(
  '../../lib/monitoring'
);

describe('logError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls console.error with structured JSON', () => {
    const err = new Error('test error');
    logError(err, { context: 'unit-test' });
    expect(console.error).toHaveBeenCalledTimes(1);
    const call = (console.error as ReturnType<typeof vi.spyOn>).mock.calls[0];
    const parsed = JSON.parse(call[0]);
    expect(parsed.message).toBe('test error');
    expect(parsed.context).toBe('unit-test');
  });

  it('handles non-Error objects gracefully', () => {
    logError('string error' as unknown as Error);
    expect(console.error).toHaveBeenCalledTimes(1);
    const call = (console.error as ReturnType<typeof vi.spyOn>).mock.calls[0];
    const parsed = JSON.parse(call[0]);
    expect(parsed.message).toContain('string error');
  });
});

describe('setMonitoringUser / clearMonitoringUser', () => {
  it('does not throw when called', () => {
    expect(() => setMonitoringUser('user-123', 'user@example.com')).not.toThrow();
    expect(() => clearMonitoringUser()).not.toThrow();
  });
});

describe('initMonitoring', () => {
  it('registers global event listeners without throwing', () => {
    expect(() => initMonitoring()).not.toThrow();
  });
});
