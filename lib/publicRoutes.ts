// SQEM-258 — which URLs render before the sign-in screen.
//
// This is a security rule, so it lives in one testable place rather than inline in a component: the
// set of routes that bypass the auth gate is exactly the set an attacker gets for free. Two members
// today — the password-recovery form (SQEM-091, it establishes its own recovery session) and a
// marketplace listing, whose data comes from an endpoint that is public by design (SQEM-177).

/**
 * The listing id in a **public** marketplace URL, or `null`.
 *
 * Matched narrowly on purpose: a uuid followed by nothing or a query string. `#/library/new` and
 * `#/library/<id>/edit` therefore keep their guard — they are the *editor*, and letting a loose
 * pattern reach it would hand a stranger the marketplace admin surface.
 */
export function publicListingIdFromHash(hash: string): string | null {
  return hash.match(/^#\/library\/([0-9a-fA-F-]{36})(?:\?.*)?$/)?.[1] ?? null;
}
