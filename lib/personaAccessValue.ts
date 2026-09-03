// SQEM-326 — the pure half of persona access: DB rows ⇄ the control's value.
//
// ⛔ **It lives in its own module because `lib/api/personaAccess.ts` imports `lib/supabase`, which
// THROWS at import time when the Supabase env vars are missing.** A unit test importing the mapping
// therefore dragged the client in and died in CI, where no `.env.local` exists — while passing
// locally, where one does. The template twin never had the problem because its mapping sits in
// `components/TemplateAccessControl`, which imports nothing with a side effect.
//
// **The rule this encodes: logic that has to be testable does not live in a module with a
// side-effecting import.** Nothing here imports anything but types.
import type { TemplateAccessValue } from '../components/TemplateAccessControl';

/**
 * The principals explicitly granted access to a persona.
 *
 * `hasRules` carries what the two empty lists cannot: **no rows at all** = open to everyone, versus
 * **a row naming nobody** = the creator alone. They are opposites and look identical without it.
 */
export type PersonaAccess = { userIds: string[]; groupIds: string[]; hasRules: boolean };

/**
 * The control's value → what to persist. Pure, so the three states can be pinned by a test.
 *
 * ⛔ The owner is never written as a row. `can_access_persona()` tests `created_by = auth.uid()`
 * first and unconditionally, so such a row grants nothing that is not already true — and a row that
 * grants nothing is a row somebody will later try to reason about (SQEM-300 learned this on
 * templates). A null `ownerId` strips nobody, which is correct rather than a fallback: with no
 * creator recorded, nobody holds implicit access and every name is doing real work.
 */
export function accessValueToPersonaAccess(
  v: TemplateAccessValue,
  ownerId?: string | null,
): PersonaAccess {
  if (v.mode === 'everyone') return { userIds: [], groupIds: [], hasRules: false };
  if (v.mode === 'private') return { userIds: [], groupIds: [], hasRules: true };
  return {
    userIds: ownerId ? v.userIds.filter(id => id !== ownerId) : v.userIds,
    groupIds: v.groupIds ?? [],
    hasRules: true,
  };
}

/** The DB rows → the control's value. `hasRules` carries what the empty lists cannot. */
export function personaAccessToValue(access: PersonaAccess): TemplateAccessValue {
  if (!access.hasRules) return { mode: 'everyone', userIds: [], groupIds: [] };
  if (access.userIds.length || access.groupIds.length) {
    return { mode: 'restricted', userIds: access.userIds, groupIds: access.groupIds };
  }
  return { mode: 'private', userIds: [], groupIds: [] };
}
