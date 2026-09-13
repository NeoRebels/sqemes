import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-399 — the self-host api-sidecar did not start from v1.11.4 to v1.11.13, and nothing noticed.
 *
 * `selfhost/api-sidecar/server.js` imports `./api/extension-config.js`. SQEM-309 turned that file
 * into `api/extension-config.ts` (it needed the model list from `constants.ts`), and the Dockerfile
 * kept copying `api/` raw into a plain Node image. Node never resolves a `.js` specifier to a `.ts`
 * file — `ERR_MODULE_NOT_FOUND` on the first import, before the process listens. Extension config,
 * MCP OAuth and the marketplace proxy were dead on every self-host release for two weeks; the export
 * was green, the Cloud endpoint (Vercel transpiles) was fine, and no test looked at the image.
 *
 * ⛔ What this pins: every handler `server.js` names must exist in the image under that name. A `.ts`
 * handler is fine only because the Dockerfile's build stage bundles it to `.js` — and the runtime
 * stage must take `api/` from that stage, never raw from the build context, or the bug is back.
 *
 * ⚠️ This is a source assertion, not a build: it cannot prove the image works, only that the file
 * still has the shape that does. The image itself was verified by hand at SQEM-399 (see
 * `pm/PRODUCTION_PROMOTION.md` in the source repository) and is the check to repeat if the
 * Dockerfile changes.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
// Line comments first, then block comments — `(/x/*)` inside a `//` line must not open a block.
const code = (src: string) => src.replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

const SERVER = code(read('selfhost/api-sidecar/server.js'));
const DOCKERFILE = read('selfhost/api-sidecar/Dockerfile')
  .split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
const STAGES = DOCKERFILE.split(/^FROM /m).slice(1);
const RUNTIME = STAGES[STAGES.length - 1];
const IMPORTS = [...SERVER.matchAll(/from '\.\/api\/([\w-]+)\.js'/g)].map(m => m[1]);

describe('SQEM-399 — every handler server.js imports exists in the image under the name it uses', () => {
  it('server.js still routes through ./api/<name>.js imports (the shape the checks below rely on)', () => {
    expect(IMPORTS.length).toBeGreaterThanOrEqual(5);
  });

  it('⛔ a handler that is TypeScript is acceptable only if the Dockerfile bundles api/*.ts with a pinned esbuild', () => {
    const bundles = /esbuild@\d+\.\d+\.\d+ .*--bundle/.test(DOCKERFILE);
    for (const name of IMPORTS) {
      const js = existsSync(resolve(ROOT, `api/${name}.js`));
      const ts = existsSync(resolve(ROOT, `api/${name}.ts`));
      expect(js || ts, `api/${name}.{js,ts} is missing — server.js imports it`).toBe(true);
      if (!js) {
        expect(bundles, `api/${name}.ts is TypeScript: the Dockerfile must bundle api/*.ts to .js (SQEM-399)`).toBe(true);
      }
    }
  });

  it('⛔ the runtime stage takes api/ from the build stage, never raw from the context', () => {
    expect(STAGES.length, 'expected a build stage and a runtime stage').toBeGreaterThanOrEqual(2);
    expect(RUNTIME).toMatch(/COPY --from=build \/out\/api \.\/api/);
    expect(RUNTIME).not.toMatch(/^COPY api /m);
  });

  it('the bundle targets node as ESM — the sidecar package.json says "type": "module"', () => {
    expect(DOCKERFILE).toMatch(/--platform=node/);
    expect(DOCKERFILE).toMatch(/--format=esm/);
    expect(JSON.parse(read('selfhost/api-sidecar/package.json')).type).toBe('module');
  });
});
