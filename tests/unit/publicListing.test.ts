import { describe, it, expect } from 'vitest';
import { publicListingIdFromHash, publicListingOffer, CLOUD_APP_URL } from '../../lib/publicRoutes';
import { CLOUD_PROD_MARKETPLACE } from '../../lib/env';

// SQEM-258 / SQEM-410 — the two rules worth pinning on the public listing page: which URL skips the
// auth gate, and where its account offer leads.
//
// ⚠️ The auth-gate half used to live in this file and was deleted with the rest of it in SQEM-302,
// while `pm/DOCUMENTATION.md` (in the source repository) kept naming this file as its guard. For
// three weeks the narrow pattern that keeps the marketplace editor behind sign-in had no test.
// Restored in SQEM-410.

const ID = '5471ce62-3f92-4dc9-b4d5-7030a58e91ce';

describe('publicListingIdFromHash — what renders before the sign-in screen', () => {
  it('lets a listing through', () => {
    expect(publicListingIdFromHash(`#/library/${ID}`)).toBe(ID);
  });

  it('lets a listing with a query string through', () => {
    expect(publicListingIdFromHash(`#/library/${ID}?ref=slack`)).toBe(ID);
  });

  it('does NOT let the editor through', () => {
    // The whole reason the pattern is narrow: /edit is the marketplace admin surface.
    expect(publicListingIdFromHash(`#/library/${ID}/edit`)).toBeNull();
    expect(publicListingIdFromHash('#/library/new')).toBeNull();
  });

  it('does not let anything else through', () => {
    for (const hash of ['#/library', '#/playbooks', '#/settings', '#/', '', '#/library/not-a-uuid',
                        `#/library/${ID}/`, `#/playbooks/${ID}`]) {
      expect(publicListingIdFromHash(hash)).toBeNull();
    }
  });
});

describe('publicListingOffer — where "Start free 14-day trial" leads (SQEM-410)', () => {
  const base = { listingId: ID, cloudMarketplaceUrl: CLOUD_PROD_MARKETPLACE };

  it('on Cloud the trial starts right here', () => {
    expect(publicListingOffer({ ...base, selfHosted: false, marketplaceUrl: CLOUD_PROD_MARKETPLACE }))
      .toEqual({ kind: 'trial' });
  });

  it('on a self-hosted instance it opens the same listing on Cloud — not the instance sign-up', () => {
    // A stranger who registered on somebody else's instance landed on "No workspace yet".
    expect(publicListingOffer({ ...base, selfHosted: true, marketplaceUrl: CLOUD_PROD_MARKETPLACE }))
      .toEqual({ kind: 'cloud', href: `https://app.sqemes.com/#/library/${ID}` });
    expect(CLOUD_APP_URL).toBe('https://app.sqemes.com');
  });

  it('an instance with its own marketplace gets no offer — that id does not exist on Cloud', () => {
    expect(publicListingOffer({ ...base, selfHosted: true, marketplaceUrl: 'https://mp.example.test/functions/v1/marketplace-public' }))
      .toEqual({ kind: 'none' });
  });
});
