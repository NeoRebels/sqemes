/**
 * SQEM-686 — an answer survives its worker: the browser holds the last finished round, and sends it back
 * when the worker went silent.
 *
 * ⚠️ **Why it exists.** A worker over its CPU time is killed with every answer on it (SQEM-674 made that
 * visible, SQEM-684 measured it on long connector runs, mid-stream, not in our code). The answer used to be
 * lost and the person had to send the message again.
 *
 * ⛔ **The state is never stored.** It is the SQEM-649 hand-over state — tool results, mail, page contents —
 * and privacy policy section 4 says those are not kept. So the server broadcasts it after every finished
 * round (`checkpoint`, in parts like SQEM-661's tables, because a broadcast message has a size limit), the
 * browser keeps the newest complete one in memory, and on silence posts it back as `{ resume }`. It is the
 * same signed envelope a hand-over carries, checked by the same `openContinuation`.
 *
 * ⛔ **Never resumed while tools ran.** A worker that died inside a tool call may have written to a connector
 * already; the round again could write twice (SQEM-674's reason not to resend). Before the first tool call
 * of a round the server says `tools` with that round's number; only a complete checkpoint of that round or a
 * later one makes the answer resumable again. The heartbeat repeats the number, so one lost `tools` event is
 * not enough to resume wrongly.
 *
 * Free of imports, so the browser (`lib/realtimeJob.ts`) and tests/unit can use it.
 */

/** One broadcast message's worth of the envelope — the size SQEM-661's table parts use. */
export const CHECKPOINT_PART_CHARS = 60_000;

/** Larger states are not sent at all: ~50 broadcasts per round is load nobody should pay for a fallback. */
export const MAX_CHECKPOINT_CHARS = 3_000_000;

/** Resumes per answer. The state carries the count, signed, so the browser cannot reset it. */
export const MAX_RESUMES = 2;

export interface CheckpointPart { round: number; part: number; parts: number; data: string }

/** The signed envelope as broadcast parts, or null when it is too large to send. */
export function checkpointParts(envelope: { state: string; sig: string }, round: number): CheckpointPart[] | null {
  const text = JSON.stringify(envelope);
  if (text.length > MAX_CHECKPOINT_CHARS) return null;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += CHECKPOINT_PART_CHARS) parts.push(text.slice(i, i + CHECKPOINT_PART_CHARS));
  return parts.map((data, part) => ({ round, part, parts: parts.length, data }));
}

export interface CheckpointHolder {
  /** One part arrived. Malformed parts are ignored. */
  add(p: unknown): void;
  /** A `tools` event or a heartbeat named the round whose tools run. */
  toolsRunning(round: unknown): void;
  /** The envelope to resume from, or null when there is none or tools ran after it. */
  resumable(): { state: string; sig: string } | null;
}

/** Browser: collect the parts, keep the newest COMPLETE checkpoint, and know whether it may be resumed. */
export function createCheckpointHolder(): CheckpointHolder {
  let pending: { round: number; parts: (string | undefined)[] } | null = null;
  let latest: { round: number; envelope: { state: string; sig: string } } | null = null;
  let toolsRound = 0;
  return {
    add(raw) {
      const p = raw as Partial<CheckpointPart> | null;
      if (!p || !Number.isInteger(p.round) || !Number.isInteger(p.part) || !Number.isInteger(p.parts)
        || typeof p.data !== 'string' || p.parts! < 1 || p.part! < 0 || p.part! >= p.parts!) return;
      if (latest && p.round! <= latest.round) return;
      if (!pending || pending.round !== p.round || pending.parts.length !== p.parts) {
        // A newer round replaces the parts of an older one that never completed.
        if (pending && p.round! < pending.round) return;
        pending = { round: p.round!, parts: new Array(p.parts!).fill(undefined) };
      }
      pending.parts[p.part!] = p.data;
      if (pending.parts.every(x => x !== undefined)) {
        try {
          const envelope = JSON.parse(pending.parts.join(''));
          if (typeof envelope?.state === 'string' && typeof envelope?.sig === 'string') {
            latest = { round: pending.round, envelope: { state: envelope.state, sig: envelope.sig } };
          }
        } catch { /* a broken checkpoint is no checkpoint */ }
        pending = null;
      }
    },
    toolsRunning(round) {
      if (Number.isInteger(round) && (round as number) > toolsRound) toolsRound = round as number;
    },
    resumable() {
      return latest && latest.round >= toolsRound ? latest.envelope : null;
    },
  };
}
