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

/** Where Sqemes Cloud lives — the target of the account offer when a listing is opened elsewhere. */
export const CLOUD_APP_URL = 'https://app.sqemes.com';

export type PublicListingOffer =
  | { kind: 'trial' }
  | { kind: 'cloud'; href: string }
  | { kind: 'none' };

/**
 * SQEM-410 — what the account offer on a public listing does.
 *
 * - **Cloud:** start the trial right here (`startTrial`, with the return trip).
 * - **Self-host reading the Cloud marketplace:** the offer still advertises Cloud (owner's decision,
 *   2026-09-14) — so the button must lead there. Before this it reloaded `#/` on the *instance*,
 *   which opened that instance's sign-up form; a stranger registered and landed on "No workspace
 *   yet — ask an administrator". The listing ids are the same in both places because self-host
 *   reads the Cloud marketplace, so the same listing on Cloud is one link away.
 * - **Self-host reading its own marketplace** (`VITE_MARKETPLACE_API_URL` pointed elsewhere): the id
 *   does not exist on Cloud, and a link to a page saying "isn't available" is worse than no offer.
 */
export function publicListingOffer(
  { selfHosted, marketplaceUrl, listingId, cloudMarketplaceUrl }:
  { selfHosted: boolean; marketplaceUrl: string; listingId: string; cloudMarketplaceUrl: string },
): PublicListingOffer {
  if (!selfHosted) return { kind: 'trial' };
  if (marketplaceUrl !== cloudMarketplaceUrl) return { kind: 'none' };
  return { kind: 'cloud', href: `${CLOUD_APP_URL}/#/library/${listingId}` };
}
