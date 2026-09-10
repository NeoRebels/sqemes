/**
 * SQEM-360 — who gets Enter-to-send, and who gets a newline.
 *
 * The chat composer bound `Enter` to send and `Shift+Enter` to a line break. On a desktop that is
 * the right pairing. ⛔ **A touch keyboard has no Shift+Enter**, so on a phone the second half of
 * the pairing did not exist: there was no way to write a paragraph, only to send.
 *
 * The rule is therefore the pointer, not the width: a coarse pointer means an on-screen keyboard,
 * and Return goes back to being Return. The send button sits right beside the field — that is how
 * every messenger on a phone behaves, so nothing has to be learned.
 *
 * ⚠️ **A tablet with a hardware keyboard reads as coarse** and loses Enter-to-send. Accepted
 * knowingly: the alternative is guessing from the viewport width, which gets the phone-in-landscape
 * case wrong — and that one has no keyboard at all, so it is the more expensive guess to get wrong.
 *
 * Kept as a pure function so the decision can be tested without a DOM: the bug was in the
 * *condition*, and a condition buried in an event handler is the kind that gets re-broken.
 */
export function shouldSendOnEnter(
  e: { key: string; shiftKey: boolean },
  coarsePointer: boolean,
): boolean {
  return e.key === 'Enter' && !e.shiftKey && !coarsePointer;
}

/**
 * True when the primary input is a touch screen. Falls back to `false` where `matchMedia` is
 * unavailable (SSR, very old browsers) — that keeps the desktop behaviour, which is the one that
 * loses nothing if the guess is wrong.
 */
export function hasCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
