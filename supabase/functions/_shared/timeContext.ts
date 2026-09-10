/**
 * SQEM-370 — tell the model what day it is.
 *
 * Without this, every "next week", "since yesterday" or "by Friday" in Chat hits a model that
 * guesses — usually at its training cut-off, which is months out and confidently wrong.
 *
 * ⛔ **Composed per request, never stored.** A date written once when a session is created lies the
 * next morning, and chat sessions stay open for days. Everything here takes `now` as an argument so
 * that is structurally impossible: there is nowhere to cache it.
 *
 * ⚠️ **Not a template variable.** Variables are filled in by a person; this is environment. It goes
 * into the system instruction the server builds, where nobody can edit it into a stale value.
 *
 * The split of work is the point:
 *   - the **client** contributes the one fact only it knows — the IANA zone from
 *     `Intl.DateTimeFormat().resolvedOptions().timeZone`
 *   - the **server** formats the moment in that zone, at the instant of the request
 *
 * A workspace-level timezone setting was rejected: it would be wrong for half of any distributed
 * team, and it would be wrong silently.
 */

/** Formats `now` in `timeZone`, or returns null when the zone is unusable. */
export function timeContextLine(now: Date, timeZone: string | undefined): string | null {
  const zone = timeZone?.trim();
  if (!zone) return null;

  try {
    // ⚠️ `timeZone` arrives from a browser and is therefore untrusted input. An unknown identifier
    // makes `Intl` throw a RangeError — caught here so a malformed value costs the date line, never
    // the message. `en-GB` for an unambiguous "10 September 2026"; a numeric locale would hand some
    // models 09/10 and others 10/09.
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);

    return `Current date and time: ${formatted} (${zone}). `
      + 'Use it whenever the user refers to a relative date such as "today", "tomorrow", '
      + '"next week" or "last month".';
  } catch {
    return null;
  }
}

/**
 * Puts the time context in front of whatever system instruction the session already has.
 *
 * ⭐ **In front, and it applies with no assistant at all.** `systemInstruction` is `undefined`
 * whenever no assistant is applied — most sessions. Returning only the caller's value in that case
 * would have limited the whole feature to assistant sessions, which is where a naive implementation
 * lands.
 */
export function withTimeContext(
  systemInstruction: string | undefined,
  now: Date,
  timeZone: string | undefined,
): string | undefined {
  const line = timeContextLine(now, timeZone);
  if (!line) return systemInstruction;
  return systemInstruction ? `${line}\n\n${systemInstruction}` : line;
}
