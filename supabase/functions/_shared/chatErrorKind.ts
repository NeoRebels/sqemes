/**
 * SQEM-653 — what kind of failure ended a chat answer, for the `[chat-error]` log line the ops monitor
 * counts. Pure, imported by `chat-message` and by the browser (`lib/aiErrors.ts`), so the overflow
 * wording is matched by ONE expression on both sides.
 *
 * ⛔ The log line carries the KIND and the status, never the message: a provider may quote parts of
 * the request back in its error, and the log is read in places the conversation is not.
 */

/**
 * SQEM-634 — a request too large for the model. Matched on the provider's wording, not the status: the
 * OpenAI stream error carries no status at all, and a 400 means a hundred other things.
 */
export const CONTEXT_OVERFLOW = /prompt is too long|exceeds the context window|context_length_exceeded|maximum context length/i;

/**
 * SQEM-653 — the model id is unknown to the provider (retired, renamed, never existed). Anthropic answers
 * 404 `not_found_error` "model: …", OpenAI 404 "The model `…` does not exist", Gemini 404 "models/… is
 * not found". Narrow on purpose: a 404 alone could be anything.
 */
const MODEL_UNKNOWN = /model[`'":\s][^\n]{0,120}(does not exist|not found|not_found|is not supported|has been deprecated|decommissioned|no longer available)|not_found_error[^\n]{0,80}model|models\/[^\s"']+ is not found/i;

export type ChatErrorKind = 'overflow' | 'model' | 'provider' | 'other';

/** `Claude API error (400): …` → 400; `OpenAI API error (stream): …` → null. */
export function errorStatus(message: string): number | null {
  const m = /API error \((\d{3})\)/.exec(message);
  return m ? Number(m[1]) : null;
}

export function chatErrorKind(message: string): ChatErrorKind {
  const text = String(message ?? '');
  if (CONTEXT_OVERFLOW.test(text)) return 'overflow';
  if (MODEL_UNKNOWN.test(text)) return 'model';
  if (/API error \(/.test(text)) return 'provider';
  return 'other';
}
