#!/usr/bin/env node
// SQEM-660 — puts the Python runtime for Chat's data analysis into public/pyodide/<version>/.
//
// ⛔ Why fetched at build time and not committed or loaded from a CDN at run time:
// - ~21 MB of binaries do not belong in git;
// - loaded from a foreign CDN at run time, the analysis frame would need network to that host, and
//   the whole point of the frame is that it has none except our own origin;
// - so the build downloads the exact files named in scripts/pyodide-manifest.json and checks every
//   one against its SHA-256 — a changed file fails the build instead of shipping.
// The checksums: core files from the npm package (integrity-checked by npm, identical on the CDN —
// compared 2026-11-06), wheels from Pyodide's own pyodide-lock.json.
// SQEM-662 — two wheels are not part of Pyodide (openpyxl and its et_xmlfile, pure Python, MIT): they
// come from PyPI, named in `urls`, with the checksum PyPI publishes.
//
// Runs before `vite build` and `vite` (prebuild / predev). Files already present with the right
// checksum are kept, so a rebuild downloads nothing.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/pyodide-manifest.json'), 'utf8'));
const outDir = join(root, 'public/pyodide', manifest.version);
mkdirSync(outDir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let fetched = 0;
for (const [name, expected] of Object.entries(manifest.files)) {
  const target = join(outDir, name);
  if (existsSync(target) && sha256(readFileSync(target)) === expected) continue;
  const url = manifest.urls?.[name] ?? manifest.base + name;
  let buf = null;
  for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 3) {
        console.error(`[fetch-pyodide] ${name}: ${e.message} (${url})`);
        process.exit(1);
      }
    }
  }
  const got = sha256(buf);
  if (got !== expected) {
    console.error(`[fetch-pyodide] ⛔ checksum mismatch for ${name}: expected ${expected}, got ${got}. Not shipping it.`);
    process.exit(1);
  }
  writeFileSync(target, buf);
  fetched++;
}
console.log(`[fetch-pyodide] ${manifest.version}: ${Object.keys(manifest.files).length} files ready (${fetched} downloaded).`);
