import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-398 — `/.well-known/sqemes-extension-config` answered 500 on production for two days.
 *
 * `api/extension-config.ts` is a Vercel serverless function. Vercel TRANSPILES it and every
 * TypeScript file it reaches, and rewrites no import specifier (SQEM-309 learned that for the
 * missing `.js`). SQEM-378 then added `export { … } from './supabase/…/libraryPrompt.ts'` to
 * `constants.ts` — which the function imports — and the emitted `constants.js` pointed at a `.ts`
 * file that did not exist under that name at runtime. Build, `tsc` and lint were green; the endpoint
 * every extension setup fetches first was dead.
 *
 * ⛔ The rule this pins: whatever `api/*` imports from the repo must be loadable by Node with the
 * specifiers exactly as written. Today that is `constants.ts`, and it has to stay a leaf.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('SQEM-398 — what the extension-config function reaches must resolve at runtime', () => {
  it('api/extension-config.ts imports constants with the .js extension (SQEM-309)', () => {
    expect(code(read('api/extension-config.ts'))).toMatch(/from '\.\.\/constants\.js'/);
  });

  it('⛔ constants.ts carries no runtime import or re-export with a .ts specifier, and no re-export at all', () => {
    const src = code(read('constants.ts'));
    const specifiers = [...src.matchAll(/(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
    for (const s of specifiers) expect(s, `specifier ${s}`).not.toMatch(/\.ts$/);
    expect(src).not.toMatch(/^export\s*\{[^}]*\}\s*from/m);
    // the only import left is the type-only one, which the transpiler erases
    expect(specifiers).toEqual(['./types']);
  });

  it('the browser still reads the one library instruction, through lib/libraryPrompt.ts', () => {
    expect(code(read('lib/libraryPrompt.ts'))).toMatch(/export \{ LIBRARY_SYSTEM_PROMPT \} from '\.\.\/supabase\/functions\/_shared\/libraryPrompt\.ts'/);
    expect(code(read('pages/Settings.tsx'))).toMatch(/import \{ LIBRARY_SYSTEM_PROMPT \} from '\.\.\/lib\/libraryPrompt'/);
  });
});
