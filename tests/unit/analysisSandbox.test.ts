import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// SQEM-660 — the isolated frame Chat's data analysis runs in. The isolation itself was MEASURED in
// Chrome (2026-11-06, local): fetch/XHR/WebSocket/Worker gone, external pyfetch fails, origin "null",
// IndexedDB denied, eval blocked by the policy, parent unreachable, micropip absent, an endless loop
// stopped after the timeout with the page still responsive. These tests keep the configuration that
// made those measurements true from drifting.
// ⛔ Re-measured 2026-11-06 behind a server that redirects every request without a cookie (what a
// hosting provider's deployment protection does, where the first version never started): Python started, the
// isolation above held, the frame made no request of its own.

const read = (p: string) => readFileSync(p, 'utf8');
const frameHtml = read('public/analysis-sandbox.html');
const frameScript = frameHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
const HASH = createHash('sha256').update(frameScript).digest('base64');
// No connect-src: default-src 'none' covers it — the frame has no network at all.
const FRAME_CSP = `default-src 'none'; script-src 'sha256-${HASH}' blob: 'wasm-unsafe-eval'; worker-src blob:; base-uri 'none'; form-action 'none'`;

describe('SQEM-660 — the frame', () => {
  it(`its own policy: no network, no eval, only its own inline script (by hash) — if this fails after an edit of the script, put sha256-${HASH} into public/analysis-sandbox.html, vercel.json and selfhost/nginx.conf`, () => {
    expect(frameHtml).toContain(`content="${FRAME_CSP}"`);
    expect(frameHtml.match(/<script/g)).toHaveLength(1);
    expect(frameHtml).not.toMatch(/<script src=/);
  });
  it('⛔ the program runs in a CLASSIC worker with the way out removed; runtime files come only from the bytes handed in', () => {
    const js = frameScript;
    expect(js).toMatch(/new Worker\(URL\.createObjectURL\(new Blob\(\[workerSource\], \{ type: 'text\/javascript' \}\)\)\);/);
    expect(js).not.toMatch(/type: 'module' \}\)/);
    expect(js).toMatch(/\['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Request', 'Worker', 'SharedWorker'\]/);
    expect(js).toMatch(/var KNOWN = \{ ready: 1, 'boot-failed': 1, result: 1, 'csp-violation': 1 \};/);
    expect(js).toMatch(/if \(ev\.source !== window\.parent\) return;/);
    expect(js).toMatch(/const BASE = 'https:\/\/runtime\.invalid\/';/);
    expect(js).toMatch(/self\.fetch = fromFiles;/);
    expect(js).toMatch(/return Promise\.reject\(new TypeError\('The analysis frame has no network/);
  });
  it('the app side: sandbox="allow-scripts" only, the timeout removes the frame, data-saver skips preloading', () => {
    const lib = read('lib/analysisSandbox.ts');
    expect(lib).toMatch(/f\.setAttribute\('sandbox', 'allow-scripts'\);/);
    expect(lib).not.toMatch(/allow-same-origin/);
    expect(lib).toMatch(/removeFrame\(\); \/\/ ends the worker/);
    expect(lib).toMatch(/if \(saveDataRequested\(\)\) return;/);
    expect(lib).toMatch(/if \(ev\.source !== f\.contentWindow\) return;/);
    expect(lib).not.toMatch(/from ['"][^'"]*supabase/);
  });
  it('the app fetches the runtime itself, checks every file against the manifest, and transfers it', () => {
    const lib = read('lib/analysisSandbox.ts');
    expect(lib).toMatch(/import manifest from '\.\.\/scripts\/pyodide-manifest\.json';/);
    expect(lib).toMatch(/if \(hex\(await crypto\.subtle\.digest\('SHA-256', buf\)\) !== sha\) throw new Error/);
    expect(lib).toMatch(/if \(d\?\.type === 'hello'\) \{/);
    expect(lib).toMatch(/postMessage\(\{ type: 'boot', files \}, '\*', Object\.values\(files\)\)/);
  });
});

describe('SQEM-660 — headers (Vercel and self-host)', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const block = (src: string) => vercel.headers.find((h: { source: string }) => h.source === src);
  it('the app keeps its policy and DENY everywhere else; the frame gets its own and may be framed by us', () => {
    expect(block('/((?!oauth/authorize|analysis-sandbox\\.html).*)').headers[0].value).toMatch(/frame-ancestors 'none'/);
    expect(block('/((?!analysis-sandbox\\.html).*)').headers).toEqual([{ key: 'X-Frame-Options', value: 'DENY' }]);
    const frame = block('/analysis-sandbox.html').headers;
    expect(frame).toContainEqual({ key: 'Content-Security-Policy', value: `${FRAME_CSP}; frame-ancestors 'self'` });
    expect(frame).toContainEqual({ key: 'X-Frame-Options', value: 'SAMEORIGIN' });
    expect(block('/(.*)').headers.map((h: { key: string }) => h.key)).not.toContain('X-Frame-Options');
  });
  it('the runtime files are same-origin only (no CORS — nobody but the app reads them) and cached for good', () => {
    expect(block('/pyodide/(.*)').headers).toEqual([{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
    expect(block('/analysis-sandbox.js')).toBeUndefined();
    const nginx = read('selfhost/nginx.conf');
    expect(nginx).toMatch(/location \/pyodide\/ \{[\s\S]*?application\/wasm wasm;/);
    expect(nginx).not.toMatch(/Access-Control-Allow-Origin/);
    expect(nginx).not.toMatch(/analysis-sandbox\.js/);
    expect(nginx).toContain(`add_header Content-Security-Policy "${FRAME_CSP}; frame-ancestors 'self'";`);
    expect(read('vite.config.ts')).not.toMatch(/cors: true/);
  });
});

describe('SQEM-660 — the runtime is fetched and checked at build time', () => {
  const manifest = JSON.parse(read('scripts/pyodide-manifest.json'));
  it('pinned version, every file with a SHA-256, the base URL of the same version', () => {
    expect(manifest.version).toBe('314.0.7');
    expect(manifest.base).toBe(`https://cdn.jsdelivr.net/pyodide/v${manifest.version}/full/`);
    for (const [name, sha] of Object.entries(manifest.files)) expect(sha, name).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining(['pyodide.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']));
    expect(Object.keys(manifest.files).some(f => f.startsWith('pandas-'))).toBe(true);
    // The app loads exactly this version, from the manifest itself.
    expect(read('lib/analysisSandbox.ts')).toContain('export const RUNTIME_BASE = `/pyodide/${manifest.version}/`;');
  });
  it('the runtime parts without a licence text in their files carry one we ship (MPL-2.0, PSF-2.0)', () => {
    const withFile = manifest.components.filter((c: { licenseFile?: string }) => c.licenseFile);
    expect(withFile.map((c: { name: string }) => c.name).sort()).toEqual(['cpython-stdlib', 'pyodide']);
    for (const c of withFile) {
      expect(c.licenseFile).toMatch(new RegExp(`^public/pyodide-licenses/.*${c.version.replace(/\./g, '\\.')}-LICENSE\\.txt$`));
      expect(read(c.licenseFile).length, c.name).toBeGreaterThan(5000);
    }
    expect(read('public/pyodide-licenses/pyodide-314.0.7-LICENSE.txt')).toMatch(/^Mozilla Public License Version 2\.0/);
    expect(read('public/pyodide-licenses/cpython-3.14.2-LICENSE.txt')).toMatch(/PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2/);
    expect(read('scripts/generate-third-party-notices.mjs')).toMatch(/pyodideComponents\.filter\(c => c\.licenseFile\)/);
  });
  it('a wrong checksum fails the build; build and dev fetch first; nothing is committed', () => {
    const script = read('scripts/fetch-pyodide.mjs');
    expect(script).toMatch(/if \(got !== expected\) \{[\s\S]*?process\.exit\(1\);/);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.prebuild).toBe('node scripts/fetch-pyodide.mjs');
    expect(pkg.scripts.predev).toBe('node scripts/fetch-pyodide.mjs');
    expect(read('.gitignore')).toMatch(/^public\/pyodide\/$/m);
  });
  it('the components are named in the third-party notices', () => {
    // SQEM-662 — openpyxl and et_xmlfile from PyPI (not in Pyodide), for Excel files written by a program.
    expect(manifest.components.map((c: { name: string }) => c.name)).toEqual(['pyodide', 'cpython-stdlib', 'numpy', 'pandas', 'python-dateutil', 'pytz', 'six', 'openpyxl', 'et-xmlfile']);
    expect(read('scripts/generate-third-party-notices.mjs')).toMatch(/## Bundled Python runtime \(Chat data analysis\)/);
  });
});
