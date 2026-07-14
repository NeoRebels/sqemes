/**
 * Wait for a background LLM job result delivered via Supabase Realtime broadcast.
 *
 * The edge function returns { jobId } immediately, then runs the LLM via
 * EdgeRuntime.waitUntil() and broadcasts the result on the `job:{jobId}` topic.
 * This client helper subscribes before the fetch and resolves when the broadcast arrives.
 */
import { supabase } from './supabase';

const JOB_TIMEOUT_MS = 180_000; // 180 s — well above the 150 s edge function limit

export function waitForJobResult(jobId: string, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const channel = supabase.channel(`job:${jobId}`);

    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      reject(new Error('The model took too long to respond. Try a shorter prompt.'));
    }, JOB_TIMEOUT_MS);

    channel
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
