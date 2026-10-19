import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-520 — a modal sits above every fixed layer of the app except the toast, the chat search and the
 * staging banner.
 * Until then `Modal` was `z-50` and the marketplace moderation drawer `z-[80]`: its confirmations
 * opened underneath it, and the first click on "Confirm" only closed the drawer.
 */
const ROOT = resolve(__dirname, '../..');
const layerOf = (cls: string) => {
  const m = cls.match(/(?:^|[\s"'`])z-(?:\[(\d+)\]|(\d+))(?=[\s"'`]|$)/);
  return m ? Number(m[1] ?? m[2]) : null;
};
const MODAL = layerOf(readFileSync(resolve(ROOT, 'components/ui/Modal.tsx'), 'utf8').match(/'fixed inset-0[^']*'/)![0])!;

describe('SQEM-520 — the modal layer', () => {
  // The moderation drawer is Cloud-only: the self-host export replaces MarketplaceAdminEntry with a stub
  // that renders nothing, so this half is strict here and silent there (the export-safety pattern).
  const privateRepo = existsSync(resolve(ROOT, 'scripts/build-public-export.sh'));

  it.skipIf(!privateRepo)('is above the moderation drawer', () => {
    const drawer = readFileSync(resolve(ROOT, 'components/MarketplaceAdminEntry.tsx'), 'utf8').match(/className="fixed inset-0 z-\[\d+\][^"]*"/)![0];
    expect(MODAL).toBeGreaterThan(layerOf(drawer)!);
  });

  // Above the modal on purpose: the toast and the chat search (100), and the staging banner (200), which
  // takes no clicks (`pointer-events-none`) and must stay visible over everything.
  const intended = (z: number, cls: string) => z === 100 || (z === 200 && /pointer-events-none/.test(cls));

  it('is above every other fixed layer, below only the toast, the chat search and the staging banner', () => {
    // Read from the file system, not `git ls-files`: the export is checked in copies without a .git.
    const walk = (dir: string): string[] => readdirSync(resolve(ROOT, dir)).flatMap(n => {
      const rel = `${dir}/${n}`;
      return statSync(resolve(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
    });
    const files = [...walk('components'), ...walk('pages'), 'App.tsx']
      .filter(f => /\.tsx$/.test(f) && f !== 'components/ui/Modal.tsx');
    const above: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(resolve(ROOT, f), 'utf8').matchAll(/["'`][^"'`]*\bfixed\b[^"'`]*["'`]/g)) {
        const z = layerOf(m[0]);
        if (z !== null && z >= MODAL && !intended(z, m[0])) above.push(`${f}: z-${z}`);
      }
    }
    expect(above).toEqual([]);
  });
});
