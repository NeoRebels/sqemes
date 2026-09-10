/**
 * Broadcast a job message to a subscribed client via Supabase Realtime REST API.
 * Called from EdgeRuntime.waitUntil() after the HTTP response has been sent.
 *
 * ⛔ **SQEM-374 — the event name is NOT written here any more.** It used to be the literal
 * `'result'`, on every message. When SQEM-372 started sending `{ delta }` through this function, each
 * delta went out as a *result*: the client's result handler fired on the first one, read
 * `payload.result` (undefined), resolved with `''` and tore the channel down — so every streamed
 * answer was an empty bubble and nothing reported an error. `jobEventFor` decides now, and
 * `tests/unit/jobEvents.test.ts` checks the names against the client's listeners.
 */
import { jobEventFor } from './jobEvents.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export async function broadcastJobResult(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      messages: [{ topic: `job:${jobId}`, event: jobEventFor(payload), payload }],
    }),
  });
}
