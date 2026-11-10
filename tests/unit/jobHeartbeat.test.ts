import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startHeartbeat, createSilenceWatch } from '../../supabase/functions/_shared/jobHeartbeat';
import { HEARTBEAT_MS, HEARTBEAT_SILENCE_MS, CLIENT_JOB_TIMEOUT_MS, DELTA_GRACE_MS } from '../../supabase/functions/_shared/chatTimeouts';
import { loadtestDies, loadtestSeconds, loadtestQuiet, simulateLostWorker, LOST_AFTER_MS } from '../../supabase/functions/_shared/loadtestMock';

/**
 * SQEM-674 — a killed edge worker broadcasts nothing (SQEM-673). The heartbeat makes that silence
 * visible: the browser says "interrupted" after 45 s instead of "took too long" after minutes.
 */
const root = (p: string) => resolve(__dirname, '../../', p);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startHeartbeat — the server half', () => {
  it('beats at once and then every interval, until stopped', () => {
    const send = vi.fn();
    const hb = startHeartbeat(send);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(send).toHaveBeenCalledTimes(4);
    hb.stop();
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('a failed send is not an error — the next beat tries again', async () => {
    const send = vi.fn().mockRejectedValue(new Error('realtime down'));
    const hb = startHeartbeat(send);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(2);
    hb.stop();
  });
});

describe('createSilenceWatch — the browser half', () => {
  it('⛔ never fires before the first alive (an old function sends none)', () => {
    const lost = vi.fn();
    const w = createSilenceWatch(lost);
    w.resume();
    w.signal();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS * 10);
    expect(lost).not.toHaveBeenCalled();
  });

  it('fires once after the silence that follows an alive', () => {
    const lost = vi.fn();
    const w = createSilenceWatch(lost);
    w.alive();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS - 1);
    expect(lost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lost).toHaveBeenCalledTimes(1);
    w.alive();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS * 2);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('every beat and every other event restart the silence', () => {
    const lost = vi.fn();
    const w = createSilenceWatch(lost);
    w.alive();
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(HEARTBEAT_MS); if (i % 2) w.alive(); else w.signal(); }
    expect(lost).not.toHaveBeenCalled();
  });

  it('a dropped channel pauses the silence, and a rejoin starts it afresh', () => {
    const lost = vi.fn();
    const w = createSilenceWatch(lost);
    w.alive();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS - 5_000);
    w.pause();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS * 3);
    expect(lost).not.toHaveBeenCalled();
    w.resume();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS - 1);
    expect(lost).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('stop ends it for good', () => {
    const lost = vi.fn();
    const w = createSilenceWatch(lost);
    w.alive();
    w.stop();
    w.alive();
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS * 2);
    expect(lost).not.toHaveBeenCalled();
  });
});

describe('the numbers', () => {
  it('three beats of silence, and well under every deadline the old message used', () => {
    expect(HEARTBEAT_SILENCE_MS).toBeGreaterThanOrEqual(HEARTBEAT_MS * 3);
    expect(HEARTBEAT_SILENCE_MS).toBeLessThan(DELTA_GRACE_MS);
    expect(HEARTBEAT_SILENCE_MS).toBeLessThan(CLIENT_JOB_TIMEOUT_MS.default);
  });
});

describe('the wiring', () => {
  const CLIENT = readFileSync(root('lib/realtimeJob.ts'), 'utf8');
  const SERVER = readFileSync(root('supabase/functions/chat-message/index.ts'), 'utf8');

  it('the browser arms on alive, follows the channel status and stops on every exit', () => {
    expect(CLIENT).toMatch(/event: 'alive' \}, \(\) => watch\.alive\(\)/);
    expect(CLIENT).toMatch(/status === 'SUBSCRIBED'\) watch\.resume\(\); else watch\.pause\(\)/);
    expect(CLIENT).toMatch(/m\.job_lost\(\)/);
    expect((CLIENT.match(/watch\.stop\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('the server starts the heartbeat for every answer and stops it in finally', () => {
    expect(SERVER).toMatch(/const heartbeat = provider === 'loadtest' && loadtestNoBeat\(modelId\) \? \{ stop: \(\) => \{\} \} : startHeartbeat\(\(\) => routineDb\s*\? routineDb\.rpc\('routine_run_heartbeat'[^)]*\)\s*: broadcastJobResult\(jobId, \{ alive: true \}\)\);/); // SQEM-676 — a routine beats on its lease instead
    expect(SERVER).toMatch(/finally \{\s*cancelWatch\.stop\(\);\s*heartbeat\.stop\(\);/);
  });

  it('both languages carry the new message', () => {
    for (const loc of ['en', 'de']) {
      const msgs = JSON.parse(readFileSync(root(`messages/${loc}.json`), 'utf8'));
      expect(typeof msgs.job_lost).toBe('string');
    }
  });
});

describe('the :die mock (load tests only)', () => {
  it('parses next to the other variants', () => {
    expect(loadtestDies('sqemes-loadtest-mock:120:die')).toBe(true);
    expect(loadtestSeconds('sqemes-loadtest-mock:120:die')).toBe(120);
    expect(loadtestQuiet('sqemes-loadtest-mock:120:die')).toBe(false);
    expect(loadtestDies('sqemes-loadtest-mock:120:quiet')).toBe(false);
    expect(loadtestDies('sqemes-loadtest-mock:120:die:quiet')).toBe(false);
    expect(loadtestDies('gpt-5:die')).toBe(false);
  });

  it('stops the heartbeat after LOST_AFTER_MS and never answers', async () => {
    const stop = vi.fn();
    const sleeps: number[] = [];
    const run = simulateLostWorker({ stop }, 120, async ms => { sleeps.push(ms); });
    await expect(run).rejects.toThrow(/simulated lost worker/);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([LOST_AFTER_MS, 120_000 - LOST_AFTER_MS]);
  });
});
