/**
 * SQEM-583 — what a stopped answer looks like once it is kept. Pure, so the wording is tested.
 *
 * The text written so far stays — it is what the person saw, and often what they stopped for — and a
 * line says it ends there on purpose. With nothing written yet, the line alone says so.
 */
export const STOPPED_NOTE = '_Stopped._';

export function stoppedContent(textSoFar: string): string {
  const text = textSoFar.trimEnd();
  return text ? `${text}\n\n${STOPPED_NOTE}` : '_Stopped before an answer._';
}
