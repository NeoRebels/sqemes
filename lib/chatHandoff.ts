/**
 * SQEM-550 (a) — the Start page's composer hands its text to Chat, which sends it
 * directly.
 *
 * ⛔ Deliberately NOT router state. `location.state` survives the Back button and a reload, so a draft
 * carried there would be sent a second time whenever someone returns to the chat — the classic
 * double-submit. A module-level slot is gone after a reload by construction, and Chat clears it the
 * moment it has taken the text. It also expires: a draft nobody picked up within `HANDOFF_MAX_AGE_MS`
 * (the person navigated elsewhere first) is not sent later out of nowhere.
 *
 * Pure, no imports — unit-testable without the store.
 */
export type ChatHandoff = { draft: string; personaId?: string; at: number };

export const HANDOFF_MAX_AGE_MS = 30_000;

let pending: ChatHandoff | null = null;

export function handOffToChat(draft: string, personaId?: string, now: number = Date.now()): void {
  const text = draft.trim();
  pending = text ? { draft: text, personaId, at: now } : null;
}

/** The waiting handoff, or null — expired ones are dropped on the way. Does not consume. */
export function peekChatHandoff(now: number = Date.now()): ChatHandoff | null {
  if (pending && now - pending.at > HANDOFF_MAX_AGE_MS) pending = null;
  return pending;
}

export function clearChatHandoff(): void {
  pending = null;
}
