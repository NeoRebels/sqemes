/**
 * SQEM-674 — a running chat answer says "still alive", so a dead one is noticed in seconds, not minutes.
 *
 * ⚠️ **Why it exists.** When an edge worker exceeds its CPU time, Supabase kills it together with every
 * answer running on it: no `[chat-error]`, no result, nothing on `job:<jobId>` (seen in load tests
 * with many runs at once). The browser used to wait for its full deadline (180 s, longer while text
 * streams) and then said "the model took too long, try a shorter prompt", which blames the wrong thing.
 *
 * The server half, `startHeartbeat`, broadcasts `alive` at once and then every `HEARTBEAT_MS` while the
 * answer runs. A killed worker takes its timer with it, so the silence IS the signal. The browser half,
 * `createSilenceWatch`, ends the wait after `HEARTBEAT_SILENCE_MS` without any event.
 *
 * ⛔ **The watch is armed only by the first `alive`.** Vercel serves the new frontend minutes before the
 * edge functions are deployed (SQEM-612), and other callers of `waitForJobResult` (authoring, execute-step)
 * never send `alive`. Armed from the start, every answer from an old function would be "interrupted".
 *
 * ⚠️ Silence counts only while the Realtime channel is joined. A reconnect starts it afresh, so the
 * person's own network blip is not reported as a server failure.
 *
 * Deliberately free of imports apart from the timeouts, so tests/unit can drive both halves with fake timers.
 */
import { HEARTBEAT_MS, HEARTBEAT_SILENCE_MS } from './chatTimeouts.ts';

/** Server: send `alive` now and every `intervalMs` until `stop()`. A failed send is not an error. */
export function startHeartbeat(send: () => Promise<unknown> | unknown, intervalMs = HEARTBEAT_MS): { stop: () => void } {
  const beat = () => { try { void Promise.resolve(send()).catch(() => {}); } catch { /* next beat tries again */ } };
  beat();
  const timer = setInterval(beat, intervalMs);
  return { stop: () => clearInterval(timer) };
}

export interface SilenceWatch {
  /** An `alive` arrived: arms the watch and restarts the silence. */
  alive(): void;
  /** Any other event arrived: restarts the silence once armed. */
  signal(): void;
  /** The channel is joined (again): restarts the silence once armed. */
  resume(): void;
  /** The channel dropped: silence does not count until it is joined again. */
  pause(): void;
  /** The wait ended for another reason. */
  stop(): void;
}

/** Browser: calls `onLost` once after `silenceMs` without an event, but only after the first `alive`. */
export function createSilenceWatch(onLost: () => void, silenceMs = HEARTBEAT_SILENCE_MS): SilenceWatch {
  let armed = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const restart = () => {
    if (!armed || done) return;
    clear();
    timer = setTimeout(() => { if (done) return; done = true; onLost(); }, silenceMs);
  };
  return {
    alive() { armed = true; restart(); },
    signal: restart,
    resume: restart,
    pause: clear,
    stop() { done = true; clear(); },
  };
}
