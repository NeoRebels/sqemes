// Shared external links (one place to maintain).

// Sqemes Chrome Web Store extension page.
export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/sqemes-%E2%80%93-prompt-templates/laaiobhchfmabhembnkpkhjfmnkbmbai';

// SQEM-079 — public extension id (from the store URL), used by useExtensionInstalled()
// to ping the extension via its externally_connectable handshake.
export const EXTENSION_ID = 'laaiobhchfmabhembnkpkhjfmnkbmbai';

/**
 * SQEM-485 — where "What's new" goes when the Gleap window cannot show it. The changelog entries live
 * in Gleap (News, type CHANGELOG), and Gleap publishes the same entries on a public page — the fallback
 * when the widget is not running. On a self-hosted instance the release notes on GitHub are what an
 * operator receives.
 */
export const WHATS_NEW_FALLBACK_URL = 'https://roadmap.sqemes.com/en/changelogs';
export const SELF_HOST_RELEASES_URL = 'https://github.com/NeoRebels/sqemes/releases';
