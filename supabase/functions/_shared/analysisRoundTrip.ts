/**
 * SQEM-660 — the round trip behind `run_analysis`: the program goes to the person's browser on the
 * job's channel (`job:<jobId>`, event `analysis`), the browser runs it in the isolated frame and sends
 * the printed result back on `analysis:<jobId>` (event `analysis_result`, matched by `callId`).
 *
 * ⛔ Broadcast, not a table: program and result are the person's data and are not stored anywhere
 * (privacy policy, section 4 — the same reason SQEM-649's continuation state travels in the request).
 * ⚠️ The listener is subscribed BEFORE the program is sent, so a fast browser cannot answer into the
 * void; the wait covers a first start of Python in the browser (download, up to 120 s) plus the run.
 * If the chat is closed meanwhile nobody answers: the tool reports that, the answer goes on.
 */

import { createAdminClient } from './supabase-admin.ts';
import { broadcastJobResult } from './broadcast.ts';
import type { AnalysisRunResult } from './analysisTool.ts';

/** Python's first start in the browser (≤ 120 s, lib/analysisSandbox.ts) + one run (30 s) + margin. */
export const ANALYSIS_WAIT_MS = 170_000;

export async function requestBrowserAnalysis(jobId: string, code: string, signal?: AbortSignal): Promise<AnalysisRunResult> {
  const callId = crypto.randomUUID();
  const client = createAdminClient();
  const channel = client.channel(`analysis:${jobId}`);
  try {
    return await new Promise<AnalysisRunResult>((resolve, reject) => {
      let sent = false;
      const timer = setTimeout(
        () => reject(new Error('The browser did not return the analysis in time — the chat may have been closed or left.')),
        ANALYSIS_WAIT_MS,
      );
      const onAbort = () => { clearTimeout(timer); reject(new Error('Stopped.')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      channel
        .on('broadcast', { event: 'analysis_result' }, ({ payload }: { payload: Record<string, unknown> }) => {
          if (payload?.callId !== callId) return;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve({
            ok: payload.ok === true,
            output: String(payload.output ?? '').slice(0, 20_000),
            error: payload.error ? String(payload.error).slice(0, 4000) : undefined,
            truncated: payload.truncated === true,
            unstarted: payload.unstarted === true,
          });
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED' && !sent) {
            sent = true; // a reconnect fires SUBSCRIBED again; the program goes out once
            broadcastJobResult(jobId, { analysis: { callId, code } }).catch((e) => {
              clearTimeout(timer);
              reject(new Error(`The program could not be sent to the browser: ${(e as Error)?.message}`));
            });
          } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !sent) {
            clearTimeout(timer);
            reject(new Error('The analysis channel could not be opened.'));
          }
        });
    });
  } finally {
    try { await client.removeChannel(channel); } catch { /* the worker ends anyway */ }
  }
}
