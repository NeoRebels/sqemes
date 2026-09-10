/**
 * Wait for a background LLM job result delivered via Supabase Realtime broadcast.
 *
 * The edge function returns { jobId } immediately, then runs the LLM via
 * EdgeRuntime.waitUntil() and broadcasts the result on the `job:{jobId}` topic.
 * This client helper subscribes before the fetch and resolves when the broadcast arrives.
 */
import { supabase } from './supabase';

const JOB_TIMEOUT_MS = 180_000; // 180 s — well above the 150 s edge function limit

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
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const channel = supabase.channel(`job:${jobId}`);

    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      reject(new Error('The model took too long to respond. Try a shorter prompt.'));
    }, JOB_TIMEOUT_MS);

    channel
      .on('broadcast', { event: 'delta' }, ({ payload }: { payload: { delta?: string } }) => {
        // ⚠️ Deliberately does NOT touch the timeout. A stream that starts and then stalls must
        // still time out — refreshing on every delta would let a wedged provider hold the UI open
        // indefinitely, which is worse than an honest timeout because nothing ever reports it.
        if (typeof payload.delta === 'string') onDelta?.(payload.delta);
      })
      .on('broadcast', { event: 'result' }, ({ payload }: { payload: { result?: string; error?: string } }) => {
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        if (payload.error) {
          reject(new Error(payload.error));
        } else {
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
