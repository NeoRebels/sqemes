/**
 * Broadcast a job result to a subscribed client via Supabase Realtime REST API.
 * Called from EdgeRuntime.waitUntil() after the HTTP response has been sent.
 */
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
      messages: [{ topic: `job:${jobId}`, event: 'result', payload }],
    }),
  });
}
