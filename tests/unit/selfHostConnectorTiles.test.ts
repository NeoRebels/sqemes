import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-452 — which connector tiles a self-hosted instance may see.
 *
 * ⛔ **The gate used to replace the WHOLE Apps card with a Cloud advert.** Written in SQEM-150, when
 * the list held Google and Microsoft and its reason — *"the managed one-click apps need Cloud OAuth
 * infra"* — was true of everything it covered. The list grew to fifteen; the gate did not. **Seven
 * tiles needing nothing from us were hidden behind a sales pitch**, and it took until a self-host cut
 * for anyone to look.
 *
 * ⭐ That is why this test pins the SPLIT rather than the mechanism: the next tile will be added by
 * someone reading `OAUTH_APPS`, not this file.
 */
const CARD = readFileSync(resolve(__dirname, '../../components/ConnectorsCard.tsx'), 'utf8');

/** Every tile, straight out of the one list that defines them. */
const TILES = [...CARD.slice(CARD.indexOf('const OAUTH_APPS'), CARD.indexOf('\n];', CARD.indexOf('const OAUTH_APPS')))
  .matchAll(/id: '([a-z-]+)', provider: '([a-z-]+)'/g)].map(m => ({ id: m[1], provider: m[2] }));

describe('SQEM-452 — self-host tiles', () => {
  it('the list is read correctly before anything is claimed about it', () => {
    // A split assertion over an empty array passes and proves nothing.
    expect(TILES.length).toBe(15);
  });

  it('⛔ exactly the seven self-sufficient tiles are available on self-host', () => {
    // None of these needs a credential we hold: dynamic registration (Plaud, Notion, Noota), a client
    // id the person registers themselves (Nifty), a pasted token (GitHub, Shopify), or no sign-in at
    // all (Shopify Storefront — the plainest case, and it works against shops nobody here owns).
    const cloudOnly = ['google', 'microsoft'];
    const available = TILES.filter(t => !cloudOnly.includes(t.provider)).map(t => t.id);
    expect(available).toEqual(['plaud', 'notion', 'noota', 'nifty', 'github', 'shopify', 'shopify-storefront']);
  });

  it('…and exactly the eight that need OUR OAuth app are not', () => {
    // Their client ids come from GOOGLE_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_ID, which a
    // self-hoster does not have. This half of the gate was always right.
    const hidden = TILES.filter(t => ['google', 'microsoft'].includes(t.provider)).map(t => t.id);
    expect(hidden).toEqual([
      'google-gmail', 'google-calendar', 'google-drive', 'google-docs', 'google-sheets',
      'microsoft-outlook', 'microsoft-calendar', 'microsoft-onedrive',
    ]);
  });

  it('⚠️ a new provider defaults to AVAILABLE, and the rule is a filter, not a wrapper', () => {
    // Get this wrong for a cloud-only tile and the operator meets "not configured on this instance",
    // which `connector-oauth-start` already returns — visible and self-explanatory. Get it wrong the
    // other way and the tile silently vanishes, which is the bug this ticket fixes. A loud wrong
    // beats a quiet one, so the allow-list names what is EXCLUDED.
    expect(CARD).toMatch(/const CLOUD_ONLY_PROVIDERS = \['google', 'microsoft'\]/);
    expect(CARD).toMatch(/CLOUD_ONLY_PROVIDERS\.includes\(app\.provider\)/);
    expect(CARD).toMatch(/const VISIBLE_APPS = IS_SELF_HOSTED \? OAUTH_APPS\.filter\(a => !needsCloudOAuth\(a\)\) : OAUTH_APPS/);
    // The tiles render from the filtered list…
    expect(CARD).toMatch(/\{VISIBLE_APPS\.map\(app => \{/);
    // …and the card is no longer swapped out wholesale.
    expect(CARD).not.toMatch(/One-click app connectors are available on sqemes Cloud/);
  });

  it('⛔ the advert names the tiles it is about, from the list — not from a sentence', () => {
    // The old copy read "Gmail, Google Calendar, Docs, Sheets, Drive, and Outlook" and was already
    // wrong: the card by then also held Plaud, Notion, Noota, Nifty, Shopify and GitHub. A hard-coded
    // list of names beside a real list is the same failure as the gate itself, one layer down.
    expect(CARD).toMatch(/\{CLOUD_ONLY_APPS\.map\(a => a\.name\)\.join\(', '\)\}/);
    expect(CARD).not.toMatch(/Connect Gmail, Google Calendar, Docs, Sheets, Drive, and Outlook/);
    // Its icon row, too — it used to show all fifteen while advertising six.
    expect(CARD).toMatch(/\{CLOUD_ONLY_APPS\.map\(app => \(/);
  });
});
