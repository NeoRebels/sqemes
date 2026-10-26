/**
 * Wait for a background LLM job result delivered via Supabase Realtime broadcast.
 *
 * The edge function returns { jobId } immediately, then runs the LLM via
 * EdgeRuntime.waitUntil() and broadcasts the result on the `job:{jobId}` topic.
 * This client helper subscribes before the fetch and resolves when the broadcast arrives.
 */
import { supabase } from './supabase';
import { CLIENT_JOB_TIMEOUT_MS, nextJobDeadline } from '../supabase/functions/_shared/chatTimeouts.ts';

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
  onResultMeta?: (meta: { loadedTemplateIds?: unknown; libraryChanges?: unknown; webSources?: unknown; generatedFiles?: unknown }) => void,
  /**
   * SQEM-582 — how far deltas may push the deadline (from the start). Defaults to `timeoutMs`, i.e.
   * deltas extend nothing — callers that do not stream keep the old behaviour exactly.
   */
  hardCapMs: number = timeoutMs,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const channel = supabase.channel(`job:${jobId}`);
    const startedAt = Date.now();
    let deadline = startedAt + timeoutMs;
    let timeout: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        supabase.removeChannel(channel);
        reject(new Error('The model took too long to respond. Try a shorter prompt.'));
      }, Math.max(0, deadline - Date.now()));
    };
    arm();

    channel
      .on('broadcast', { event: 'delta' }, ({ payload }: { payload: { delta?: string } }) => {
        // SQEM-582 — a delta moves the deadline to "a minute from now", never past the hard cap. A
        // stream that is writing is not cut off at a fixed mark any more; one that starts and then
        // stalls still ends — a minute after its last delta at most — which is what the old rule
        // ("deltas never touch the timeout") protected: a wedged provider must not hold the UI open.
        if (typeof payload.delta === 'string') {
          const next = nextJobDeadline(deadline, Date.now(), startedAt, hardCapMs);
          if (next !== deadline) { deadline = next; arm(); }
          onDelta?.(payload.delta);
        }
      })
      .on('broadcast', { event: 'result' }, ({ payload }: { payload: { result?: string; error?: string; loadedTemplateIds?: unknown; libraryChanges?: unknown; webSources?: unknown; generatedFiles?: unknown } }) => {
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        if (payload.error) {
          reject(new Error(payload.error));
        } else {
          onResultMeta?.({ loadedTemplateIds: payload.loadedTemplateIds, libraryChanges: payload.libraryChanges, webSources: payload.webSources, generatedFiles: payload.generatedFiles });
          resolve(payload.result ?? '');
        }
      })
      .subscribe();

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      supabase.removeChannel(channel);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
  });
}
