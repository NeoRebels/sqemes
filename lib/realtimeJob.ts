/**
 * Wait for a background LLM job result delivered via Supabase Realtime broadcast.
 *
 * The edge function returns { jobId } immediately, then runs the LLM via
 * EdgeRuntime.waitUntil() and broadcasts the result on the `job:{jobId}` topic.
 * This client helper subscribes before the fetch and resolves when the broadcast arrives.
 */
import { supabase } from './supabase';
import { m } from './i18n';
import { CLIENT_JOB_TIMEOUT_MS, nextJobDeadline } from '../supabase/functions/_shared/chatTimeouts.ts';
import { createSilenceWatch } from '../supabase/functions/_shared/jobHeartbeat.ts';
import { createCheckpointHolder, MAX_RESUMES } from '../supabase/functions/_shared/chatCheckpoint.ts';

/**
 * SQEM-372 — `onDelta` receives the answer as it is written.
 *
 * ⚠️ **Each delta carries the WHOLE text so far, not an increment.** Realtime broadcast is
 * best-effort; with increments one dropped message would leave a permanent hole in the middle of a
 * reply. So the caller REPLACES what it is showing rather than appending — and any message that
 * arrives repairs every drop before it.
 */
export function waitForJobResult(
  jobId: string,
  signal?: AbortSignal,
  onDelta?: (textSoFar: string) => void,
  /**
   * SQEM-381 — how long to wait for the terminal broadcast. ⛔ Must exceed the server's provider
   * timeout for the same turn, or the honest 504 arrives at nobody; `_shared/chatTimeouts.ts` holds
   * both numbers and the test that keeps them ordered. Chat passes the connector-aware value; every
   * other caller keeps the default. (The old comment here cited a "150 s edge function limit" — the
   * free-plan number; production is paid, 400 s.)
   */
  timeoutMs: number = CLIENT_JOB_TIMEOUT_MS.default,
  /**
   * SQEM-551 — called once, just before resolving, with the extra fields the result carried (Chat:
   * `loadedTemplateIds`, and since SQEM-561 `libraryChanges`). Unvalidated — the caller normalizes.
   * Other callers leave it out.
   */
  onResultMeta?: (meta: { loadedTemplateIds?: unknown; libraryChanges?: unknown; webSources?: unknown; generatedFiles?: unknown; connectorIds?: unknown; analyses?: unknown }) => void,
  /**
   * SQEM-582 — how far deltas may push the deadline (from the start). Defaults to `timeoutMs`, i.e.
   * deltas extend nothing — callers that do not stream keep the old behaviour exactly.
   */
  hardCapMs: number = timeoutMs,
  /**
   * SQEM-649 — the cap once the server said the answer goes on in a new invocation (`continued`).
   * Defaults to `hardCapMs`: a caller that does not pass it keeps its old limit exactly.
   */
  chainCapMs: number = hardCapMs,
  /** SQEM-649 — told on every `continued`, so the page can say the answer is still being worked on. */
  onContinued?: () => void,
  /**
   * SQEM-660 — a program the model wants run on the attached tables. The caller runs it in the
   * isolated frame and answers with `sendAnalysisResult`. While it runs the deadline moves on: a first
   * start of Python can take two minutes, and the server waits for it.
   */
  onAnalysis?: (req: { callId: string; code: string; tables?: { key: string; parts: number }[] }) => void,
  /**
   * SQEM-661 — one part of a connector table, sent ahead of the program that needs it (`tables` on the
   * request names what it expects). The caller collects them; a broadcast can be lost, so it checks.
   */
  onAnalysisTable?: (part: { key: string; part: number; parts: number; csv: string }) => void,
  /**
   * SQEM-686 — the worker went silent and there is a checkpoint to go on from: post it back (Chat:
   * `chat-message` with `{ resume }`). True when the server took it; the wait then goes on on this channel.
   * Absent ⇒ silence ends the wait as before (every caller but Chat).
   */
  onResume?: (checkpoint: { state: string; sig: string }) => Promise<boolean>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const channel = supabase.channel(`job:${jobId}`);
    const startedAt = Date.now();
    let deadline = startedAt + timeoutMs;
    let cap = hardCapMs;
    let timeout: ReturnType<typeof setTimeout>;
    // SQEM-686 — the newest complete checkpoint, and whether tools ran after it.
    const checkpoints = createCheckpointHolder();
    let resumes = 0;
    let settled = false; // a result or Stop may come while a resume is on its way
    const lost = () => {
      settled = true;
      clearTimeout(timeout);
      supabase.removeChannel(channel);
      reject(new Error(m.job_lost()));
    };
    // SQEM-674 — armed by the first `alive`; a killed worker goes silent and this ends the wait.
    // SQEM-686 — unless the answer can go on from its last checkpoint: then once more, on a new watch.
    const onSilence = () => {
      const envelope = onResume && resumes < MAX_RESUMES ? checkpoints.resumable() : null;
      if (!envelope) return lost();
      resumes += 1;
      onResume!(envelope).catch(() => false).then(ok => {
        if (settled) return;
        if (!ok) return lost();
        watch = createSilenceWatch(onSilence);
        watch.alive(); // the silence counts from now, even if the new worker's first beat is lost
        cap = Math.max(cap, chainCapMs);
        deadline = Math.min(Math.max(deadline, Date.now() + timeoutMs), startedAt + cap);
        arm();
        onContinued?.();
      });
    };
    let watch = createSilenceWatch(onSilence);
    const arm = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        settled = true;
        watch.stop();
        supabase.removeChannel(channel);
        reject(new Error(m.job_timeout()));
      }, Math.max(0, deadline - Date.now()));
    };
    arm();

    channel
      .on('broadcast', { event: 'delta' }, ({ payload }: { payload: { delta?: string } }) => {
        // SQEM-582 — a delta moves the deadline to "a minute from now", never past the hard cap. A
        // stream that is writing is not cut off at a fixed mark any more; one that starts and then
        // stalls still ends — a minute after its last delta at most — which is what the old rule
        // ("deltas never touch the timeout") protected: a wedged provider must not hold the UI open.
        watch.signal();
        if (typeof payload.delta === 'string') {
          const next = nextJobDeadline(deadline, Date.now(), startedAt, cap);
          if (next !== deadline) { deadline = next; arm(); }
          onDelta?.(payload.delta);
        }
      })
      // SQEM-649 — a new invocation took the answer over: it gets a full wait of its own, up to the chain cap.
      .on('broadcast', { event: 'continued' }, () => {
        watch.signal();
        cap = Math.max(cap, chainCapMs);
        deadline = Math.min(Math.max(deadline, Date.now() + timeoutMs), startedAt + cap);
        arm();
        onContinued?.();
      })
      // SQEM-660 — run_analysis: the program comes here, the result goes back on analysis:<jobId>.
      .on('broadcast', { event: 'analysis_table' }, ({ payload }: { payload: { analysisTable?: { key?: unknown; part?: unknown; parts?: unknown; csv?: unknown } } }) => {
        watch.signal();
        const t = payload?.analysisTable;
        if (!t || typeof t.key !== 'string' || typeof t.csv !== 'string' || !Number.isInteger(t.part) || !Number.isInteger(t.parts)) return;
        onAnalysisTable?.({ key: t.key, part: t.part as number, parts: t.parts as number, csv: t.csv });
      })
      .on('broadcast', { event: 'analysis' }, ({ payload }: { payload: { analysis?: { callId?: unknown; code?: unknown; tables?: unknown } } }) => {
        watch.signal();
        const a = payload?.analysis;
        if (!a || typeof a.callId !== 'string' || typeof a.code !== 'string') return;
        cap = Math.max(cap, chainCapMs);
        deadline = Math.min(Math.max(deadline, Date.now() + ANALYSIS_DEADLINE_MS), startedAt + cap);
        arm();
        const tables = Array.isArray(a.tables)
          ? a.tables.filter((x): x is { key: string; parts: number } => !!x && typeof x.key === 'string' && Number.isInteger(x.parts))
          : undefined;
        onAnalysis?.({ callId: a.callId, code: a.code, ...(tables?.length ? { tables } : {}) });
      })
      // SQEM-674 — the heartbeat of a running answer. SQEM-686 — it repeats the round whose tools run.
      .on('broadcast', { event: 'alive' }, ({ payload }: { payload: { toolsRound?: unknown } }) => {
        checkpoints.toolsRunning(payload?.toolsRound);
        watch.alive();
      })
      // SQEM-686 — the state after a finished round, in parts; and the mark that a round's tools run now.
      .on('broadcast', { event: 'checkpoint' }, ({ payload }: { payload: { checkpoint?: unknown } }) => {
        watch.signal();
        checkpoints.add(payload?.checkpoint);
      })
      .on('broadcast', { event: 'tools' }, ({ payload }: { payload: { toolsRound?: unknown } }) => {
        watch.signal();
        checkpoints.toolsRunning(payload?.toolsRound);
      })
      .on('broadcast', { event: 'result' }, ({ payload }: { payload: { result?: string; error?: string; loadedTemplateIds?: unknown; libraryChanges?: unknown; webSources?: unknown; generatedFiles?: unknown; connectorIds?: unknown; analyses?: unknown } }) => {
        settled = true;
        clearTimeout(timeout);
        watch.stop();
        supabase.removeChannel(channel);
        if (payload.error) {
          reject(new Error(payload.error));
        } else {
          // SQEM-651 — `connectorIds`: the connectors the session carries on with (fetched by the model).
          onResultMeta?.({ loadedTemplateIds: payload.loadedTemplateIds, libraryChanges: payload.libraryChanges, webSources: payload.webSources, generatedFiles: payload.generatedFiles, connectorIds: payload.connectorIds, analyses: payload.analyses });
          resolve(payload.result ?? '');
        }
      })
      // SQEM-674 — silence counts only while joined; a rejoin starts it afresh.
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') watch.resume(); else watch.pause(); });

    signal?.addEventListener('abort', () => {
      settled = true;
      clearTimeout(timeout);
      watch.stop();
      supabase.removeChannel(channel);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
  });
}

/** SQEM-660 — how far an `analysis` request moves the wait on: the server's own wait (170 s) plus margin. */
export const ANALYSIS_DEADLINE_MS = 200_000;

/**
 * SQEM-660 — the result of one run_analysis program, back to the waiting chat-message invocation.
 * Over REST (`httpSend`): the browser does not need to join a second channel to answer once.
 * Never throws — a lost answer becomes the server's "the browser did not answer".
 */
export async function sendAnalysisResult(jobId: string, payload: { callId: string; ok: boolean; output: string; error?: string; truncated?: boolean; unstarted?: boolean; missingTables?: string[]; files?: { name: string; size: number }[]; skipped?: string[] }): Promise<void> {
  const channel = supabase.channel(`analysis:${jobId}`);
  try {
    await channel.httpSend('analysis_result', payload);
  } catch (e) {
    console.warn('[analysis] result not delivered:', (e as Error)?.message ?? e);
  } finally {
    void supabase.removeChannel(channel);
  }
}
