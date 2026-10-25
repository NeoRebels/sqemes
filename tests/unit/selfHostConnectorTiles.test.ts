import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-589 — self-host ships NO one-click apps; one line points to sqemes Cloud instead.
 *
 * ⛔ This reverses SQEM-452, which had made seven tiles visible on self-host ("a loud wrong beats a
 * quiet one"). The apps are a sqemes Cloud feature, so they are neither shown nor shipped. Custom connectors (incl. OAuth) are unaffected.
 *
 * Strict in the private repo; in the public export the stubs ARE the files, so the export half checks
 * that what ships is empty.
 */
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const PRIVATE = existsSync(resolve(ROOT, 'scripts/build-public-export.sh'));
const CARD = read('components/ConnectorsCard.tsx');

describe('SQEM-589 — no apps on self-host', () => {
  it('the card shows no tiles on self-host, even built from this repo', () => {
    expect(CARD).toMatch(/const VISIBLE_APPS = IS_SELF_HOSTED \? \[\] : OAUTH_APPS;/);
    expect(CARD).toMatch(/\{VISIBLE_APPS\.map\(app => \{/);
  });

  it('…and says it in one line, on design tokens, with a link to Cloud', () => {
    const line = CARD.slice(CARD.indexOf('SQEM-589 — on self-host the apps'), CARD.indexOf('{VISIBLE_APPS.map'));
    expect(line).toContain('are available on sqemes Cloud.');
    expect(line).toMatch(/bg-surface-sunken border border-line/);
    expect(line).toMatch(/href="https:\/\/sqemes\.com"/);
    expect(line).not.toMatch(/\b(?:bg|text|border)-(?:slate|brand|white|red|emerald)-?\d*\b/);
    // the old banner with icons and a button is gone
    expect(CARD).not.toMatch(/CLOUD_ONLY_APPS|Explore sqemes Cloud/);
  });

  it.skipIf(!PRIVATE)('the export replaces the tile list and the app registry with EMPTY stubs', () => {
    const tiles = read('publish/components/connectorAppTiles.tsx');
    expect(tiles).toMatch(/export const OAUTH_APPS: AppTile\[\] = \[\];/);
    const reg = read('publish/supabase/functions/_shared/connectorAppRegistry.ts');
    for (const r of ['CONNECTOR_APPS', 'TOKEN_APPS', 'MCP_OAUTH_APPS']) expect(reg).toMatch(new RegExp(`export const ${r}: Record<string, \\w+> = \\{\\};`));
  });

  it.skipIf(!PRIVATE)('the export prunes the shims and every app logo', () => {
    const script = read('scripts/build-public-export.sh');
    for (const p of ['supabase/functions/mcp-outlook', 'supabase/functions/mcp-msgraph', 'supabase/functions/mcp-shopify', 'assets/connectors', 'components/icons/AppBrandIcons.tsx', 'components/icons/GmailIcon.tsx', 'components/icons/NotionIcon.tsx']) {
      expect(script, p).toContain(p);
    }
  });

  it.skipIf(PRIVATE)('in the export: what ships is empty', () => {
    expect(read('components/connectorAppTiles.tsx')).toMatch(/export const OAUTH_APPS: AppTile\[\] = \[\];/);
    expect(existsSync(resolve(ROOT, 'supabase/functions/mcp-msgraph'))).toBe(false);
  });
});
