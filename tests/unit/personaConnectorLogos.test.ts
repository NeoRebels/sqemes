import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { appLogoForServiceKey } from '../../components/connectorAppTiles';
// SQEM-656 — the export prunes the Cloud-only servers and stubs the app tiles: strict here, silent there
// (the pattern from PRODUCTION_PROMOTION → the self-host cut, step 7).
const IN_PRIVATE_REPO = existsSync('scripts/build-public-export.sh');

/**
 * SQEM-642 — the persona editor shows each connector service's logo, and flipping a switch no longer
 * throws the column back to the top (measured at 390 px before the fix: scroll position 95 → 0).
 */
describe('SQEM-642 — a service key finds its app logo', () => {
  it.skipIf(!IN_PRIVATE_REPO)('one-click apps by provider and name, even when nobody here has connected them', () => {
    expect(appLogoForServiceKey('app:shopify:shopify', 'w-4 h-4')).not.toBeNull();
    expect(appLogoForServiceKey('app:notion:notion', 'w-4 h-4')).not.toBeNull();
    expect(appLogoForServiceKey('app:microsoft:teams', 'w-4 h-4')).not.toBeNull();
  });

  it('a custom server or an unknown app has none here (ConnectorLogo or the plug take over)', () => {
    expect(appLogoForServiceKey('url:https://api.chatarmin.com/mcp', 'w-4 h-4')).toBeNull();
    expect(appLogoForServiceKey('app:nobody:nothing', 'w-4 h-4')).toBeNull();
    expect(appLogoForServiceKey('garbage', 'w-4 h-4')).toBeNull();
  });

  it.skipIf(!IN_PRIVATE_REPO)('the self-host stub exports the same function and returns nothing', () => {
    expect(readFileSync('publish/components/connectorAppTiles.tsx', 'utf8'))
      .toMatch(/export function appLogoForServiceKey\(_key: string, _className: string\): ReactElement \| null \{\s+return null;/);
  });
});

describe('SQEM-642 — the editor', () => {
  const editor = readFileSync('pages/PersonaEditor.tsx', 'utf8');

  it('every connector row carries a logo; the URL for it is never stored', () => {
    expect(editor).toMatch(/<ServiceLogo serviceKey=\{c\.key\} mcpUrl=\{c\.mcpUrl\} \/>/);
    expect(readFileSync('components/ServiceLogo.tsx', 'utf8')).toMatch(/appLogoForServiceKey\(serviceKey, 'w-4 h-4'\) \?\? <ConnectorLogo mcpUrl=\{url\}/);
    expect(editor).toMatch(/\{ key: service\.key, name: service\.name \}/); // what toggling stores
  });

  it('⛔ growToFit is a stable callback and keeps the column\'s scroll position', () => {
    expect(editor).toMatch(/const growToFit = useCallback\(\(el: HTMLTextAreaElement \| null\) => \{/);
    const fn = editor.slice(editor.indexOf('const growToFit = useCallback'));
    expect(fn.slice(0, 1400)).toMatch(/\}, \[\]\);/);
    expect(fn).toMatch(/const scroller = el\.closest<HTMLElement>\('\.overflow-y-auto'\);/);
    expect(fn).toMatch(/if \(scroller && top !== undefined\) scroller\.scrollTop = top;/);
  });
});
