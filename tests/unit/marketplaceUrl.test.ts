import { describe, it, expect } from 'vitest';
import { marketplaceUrlFor, CLOUD_PROD_MARKETPLACE } from '../../lib/env';

// SQEM-258 — the rule that decides which marketplace a build reads. It is pinned here because it
// just went wrong in a way nobody could see: the signed-in path reads the project the app is
// pointed at, the public path read a hard-coded Cloud production. On staging those are two different
// databases, so a listing that rendered fine when signed in was "not available" to a visitor.

const STAGING = 'https://lcwbwofdvitrisrwybmi.supabase.co';

describe('marketplaceUrlFor', () => {
  it('a Cloud build reads its OWN project — this is the fix', () => {
    expect(marketplaceUrlFor({ selfHosted: false, supabaseUrl: STAGING }))
      .toBe(`${STAGING}/functions/v1/marketplace-public`);
  });

  it('production is unchanged, because its Supabase URL already is api.sqemes.com', () => {
    expect(marketplaceUrlFor({ selfHosted: false, supabaseUrl: 'https://api.sqemes.com' }))
      .toBe(CLOUD_PROD_MARKETPLACE);
  });

  it('self-host reads Cloud production, because there the marketplace really is somebody else’s', () => {
    expect(marketplaceUrlFor({ selfHosted: true, supabaseUrl: 'https://my-instance.example' }))
      .toBe(CLOUD_PROD_MARKETPLACE);
  });

  it('an explicit override wins over both', () => {
    expect(marketplaceUrlFor({ selfHosted: true, supabaseUrl: STAGING, override: 'https://x.test/mp' }))
      .toBe('https://x.test/mp');
  });

  it('an empty override disables the marketplace and is not overruled by a fallback', () => {
    expect(marketplaceUrlFor({ selfHosted: true, override: '' })).toBe('');
  });

  it('tolerates the trailing whitespace and slashes that env vars collect', () => {
    // Pasted env values have cost this project three separate outages (see PRODUCTION_PROMOTION).
    expect(marketplaceUrlFor({ selfHosted: false, supabaseUrl: `  ${STAGING}/  ` }))
      .toBe(`${STAGING}/functions/v1/marketplace-public`);
  });
});
