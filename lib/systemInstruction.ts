/**
 * SQEM-371 — how the applied templates become one system instruction.
 *
 * ⛔ **Deliberately its own module with NO imports at all.** The obvious home was
 * `lib/templateContext.ts`, next to the resolution — but that reaches `lib/api/files` and therefore
 * `lib/supabase`, which **throws at import time** when the Supabase env vars are absent. A test
 * importing this from there passes locally (where `.env.local` exists) and fails in CI, which is
 * exactly what happened before this split. Pure logic stays reachable without the client.
 */

/**
 * Composes the system instruction a request actually carries.
 *
 * ⭐ **Order is load-bearing: the assistant first, skills after.** A skill is knowledge that refines
 * a role; leading with it would let a knowledge block argue with the persona that is supposed to own
 * the conversation. Skills among themselves keep the order they were applied in — the only order a
 * person can predict.
 *
 * Returns `undefined` rather than an empty string when nothing is applied, so the request omits the
 * field entirely: some providers treat a blank system prompt differently from its absence.
 */
export function composeSystemInstruction(
  assistantText: string | null,
  skillTexts: string[],
): string | undefined {
  const parts = [assistantText, ...skillTexts].filter((p): p is string => !!p && !!p.trim());
  return parts.length ? parts.join('\n\n') : undefined;
}
