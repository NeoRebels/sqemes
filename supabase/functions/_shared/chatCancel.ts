/**
 * SQEM-583 — stopping a chat answer that is running in the background.
 *
 * The answer runs in `EdgeRuntime.waitUntil()` after the HTTP response, so the browser cannot reach it
 * directly. Stop writes one row into `chat_job_cancellations` (insert-only for clients, own rows only);
 * the job looks for it every `CANCEL_POLL_MS` and aborts its AbortController. That signal goes to every
 * provider call through `fetchWithTimeout`, which also ends a stream that is still being read — so the
 * provider stops generating and the cost stops with it.
 *
 * ⚠️ A poll, not a subscription: one primary-key lookup every two seconds and only while a job runs.
 * A Realtime subscription from inside the worker would be one more long-lived connection per answer.
 *
 * Pure apart from the injected lookup, so tests/unit can drive it with fake timers.
 */
export const CANCEL_POLL_MS = 2_000;

/** True once a cancellation exists for this job and person; the implementation also removes the row. */
export type CancelLookup = (jobId: string, userId: string) => Promise<boolean>;

export function watchForCancel(
  jobId: string,
  userId: string,
  lookup: CancelLookup,
  controller: AbortController,
  intervalMs = CANCEL_POLL_MS,
): { stop: () => void } {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      if (await lookup(jobId, userId)) {
        controller.abort();
        clearInterval(timer);
      }
    } catch {
      // A failed lookup is not a stop. The next tick tries again.
    } finally {
      busy = false;
    }
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
