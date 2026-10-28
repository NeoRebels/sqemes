import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stoppedContent, STOPPED_NOTE } from '../../lib/chatStop';
import { watchForCancel } from '../../supabase/functions/_shared/chatCancel';
import { fetchWithTimeout } from '../../supabase/functions/_shared/fetchWithTimeout';
import { en } from './i18nText';

/** SQEM-583 — Stop: the client keeps what was written, the server really stops. */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('the kept text', () => {
  it('keeps what was written and says it ends there', () => {
    expect(stoppedContent('Half an answer  \n')).toBe(`Half an answer\n\n${STOPPED_NOTE()}`);
    expect(STOPPED_NOTE()).toBe(en.chat_stopped); // SQEM-611 — '_Stopped._', in the app language
  });
  it('says so when nothing was written yet', () => {
    expect(stoppedContent('')).toBe('_Stopped before an answer._');
    expect(en.chat_stopped_empty).toBe('_Stopped before an answer._'); // SQEM-611
  });
});

describe('watchForCancel', () => {
  afterEach(() => vi.useRealTimers());
  it('aborts once the lookup finds the stop, then polls no more', async () => {
    vi.useFakeTimers();
    let hits = 0;
    const lookup = vi.fn(async () => (++hits >= 2));
    const c = new AbortController();
    watchForCancel('j', 'u', lookup, c, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith('j', 'u');
  });
  it('a failing lookup is not a stop; stop() ends the watch', async () => {
    vi.useFakeTimers();
    const lookup = vi.fn(async () => { throw new Error('db down'); });
    const c = new AbortController();
    const w = watchForCancel('j', 'u', lookup, c, 2000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(c.signal.aborted).toBe(false);
    w.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('fetchWithTimeout and an outside signal', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('⛔ a stop is reported as AbortError, never as the 504 timeout', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const c = new AbortController();
    const p = fetchWithTimeout('https://x', { signal: c.signal }, 60_000);
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError', message: 'Cancelled' });
  });
  it('an already-aborted signal aborts at once', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => init.signal!.aborted
      ? Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      : Promise.resolve(new Response('ok')));
    const c = new AbortController(); c.abort();
    await expect(fetchWithTimeout('https://x', { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('wiring', () => {
  const fn = read('supabase/functions/chat-message/index.ts');
  it('every text provider request carries the stop signal', () => {
    expect([...fn.matchAll(/cancel\.signal[,)]/g)].length).toBe(9); // `,` since SQEM-594 passes webState after it // gemini, openai, claude, 4× compatible, + connector loading (SQEM-584), + the web tools (SQEM-594)
    expect([...fn.matchAll(/^\s+signal,$/gm)].length).toBe(4);   // the four fetch sites
  });
  it('a stopped job broadcasts nothing and always ends its watch', () => {
    expect(fn).toMatch(/if \(cancel\.signal\.aborted\) \{\s*console\.log\('\[chat-cancel\]'[\s\S]*?return;\s*\}/);
    expect(fn).toMatch(/finally \{\s*cancelWatch\.stop\(\);\s*\}/);
  });
  it('the job only stops for a row with its own user', () => {
    expect(fn).toMatch(/\.eq\('job_id', j\)\.eq\('user_id', u\)/);
  });
  it('Chat: Stop replaces Send while an answer runs, and New chat stops the job too', () => {
    const chat = read('pages/Chat.tsx');
    expect(chat).toMatch(/isLoading \? \(\s*<button onClick=\{handleStop\} aria-label=\{txt\.chat_stop_label\(\)\}/);
    expect(en.chat_stop_label).toBe('Stop generating'); // SQEM-604
    expect(chat).toMatch(/const handleNewChat = \(\) => \{\s*\/\/[^\n]*\n\s*if \(runningJobRef\.current\) requestChatJobCancel/);
  });
  it('the migration lets clients insert only, and only their own row', () => {
    const sql = read('supabase/migrations/20261024200000_sqem583_chat_job_cancellations.sql');
    expect(sql).toMatch(/for insert to authenticated\s+with check \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/revoke all on public\.chat_job_cancellations from anon, authenticated;/);
    expect(sql).toMatch(/grant insert \(job_id\) on public\.chat_job_cancellations to authenticated;/);
    expect(sql).not.toMatch(/for (select|update|delete)/);
  });
});
