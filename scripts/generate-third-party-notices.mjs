#!/usr/bin/env node
// SQEM-266 — build the distribution evidence: third-party notices + an SBOM.
//
// **Run from `build-public-export.sh`, writing into the export directory — never committed here.**
// `git archive HEAD` exports only *tracked* files, so a notices file living in this repo would have
// to be regenerated and committed by hand before every release. It would then be correct on the day
// it was written and quietly wrong one release later, which is worse than absent: a stale notice
// claims a completeness it no longer has. Generating it at export time makes staleness impossible.
//
// **Zero dependencies, deliberately.** `@cyclonedx/cyclonedx-npm` or `license-checker` would do this
// in one line and drag a sizeable tree in with them. This repo gates every merge on `npm audit`
// (a single new transitive high advisory turns CI red repo-wide), so a build-time convenience is a
// standing liability. Eighty lines of `fs` cannot be advised against.
//
// **Production dependencies only.** What we distribute in built form is the app image; dev
// dependencies are fetched by whoever builds from source, under their own terms, from npm. Listing
// them would pad the file without adding an obligation.
//
// Usage: node scripts/generate-third-party-notices.mjs <DEST_DIR>

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = process.argv[2];
if (!DEST) {
  console.error('usage: generate-third-party-notices.mjs <DEST_DIR>');
  process.exit(1);
}

const LICENSE_FILE = /^(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i;

/** Every production dependency, flattened from the npm tree. name@version → true. */
function productionDependencies() {
  let json;
  try {
    json = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // `npm ls` exits non-zero on peer-dependency complaints while still printing valid JSON.
    // Refusing to continue there would make the notices depend on an unrelated warning.
    json = err.stdout;
    if (!json) throw err;
  }
  const seen = new Map();
  const walk = (deps) => {
    for (const [name, node] of Object.entries(deps || {})) {
      if (node?.version && !seen.has(`${name}@${node.version}`)) {
        seen.set(`${name}@${node.version}`, { name, version: node.version });
      }
      if (node?.dependencies) walk(node.dependencies);
    }
  };
  walk(JSON.parse(json).dependencies);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Where a package actually landed — hoisted at the root, or nested under its parent. */
function resolvePackageDir(name) {
  const direct = path.join(ROOT, 'node_modules', name);
  if (fs.existsSync(path.join(direct, 'package.json'))) return direct;
  // Nested copy (a version conflict). Find the first one; any copy carries the same licence text.
  const stack = [path.join(ROOT, 'node_modules')];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name === 'node_modules') { stack.push(p); continue; }
      if (p.endsWith(path.join('node_modules', ...name.split('/')))) {
        if (fs.existsSync(path.join(p, 'package.json'))) return p;
      }
      if (e.name.startsWith('@') || fs.existsSync(path.join(p, 'node_modules'))) stack.push(p);
    }
  }
  return null;
}

function readLicense(dir) {
  if (!dir) return { id: null, text: null };
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* keep empty */ }
  const id = typeof pkg.license === 'string'
    ? pkg.license
    : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map(l => l.type).join(' OR ') : null);

  let text = null;
  try {
    const file = fs.readdirSync(dir).find(f => LICENSE_FILE.test(f));
    if (file) text = fs.readFileSync(path.join(dir, file), 'utf8').trim();
  } catch { /* no licence file shipped — recorded as such below */ }
  return { id, text };
}

/** The pinned images in the self-host compose files. The inventory the ticket asks for. */
function containerImages() {
  const dir = path.join(ROOT, 'selfhost');
  const images = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yml'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/^\s*image:\s*([^\s#]+)/gm)) images.add(m[1]);
  }
  return [...images].sort();
}

// ---------------------------------------------------------------------------------------------

const deps = productionDependencies();
const images = containerImages();

// Group by licence text rather than repeating it per package: the obligation is that the text and
// its copyright line travel with the distribution, not that they are printed 400 times.
const byText = new Map();
const noText = [];
for (const dep of deps) {
  const { id, text } = readLicense(resolvePackageDir(dep.name));
  dep.licenseId = id ?? 'UNKNOWN';
  if (!text) { noText.push(dep); continue; }
  const key = createHash('sha256').update(text).digest('hex');
  if (!byText.has(key)) byText.set(key, { text, packages: [] });
  byText.get(key).packages.push(dep);
}

const stamp = new Date().toISOString().slice(0, 10);

const notices = [
  '# Third-Party Notices',
  '',
  `Generated ${stamp} from the production dependency tree. **Do not edit by hand** — it is rebuilt`,
  'by `scripts/build-public-export.sh` on every release, which is what keeps it from going stale.',
  '',
  'Sqemes itself is licensed under the Sustainable Use License from v1.11.0 (AGPL-3.0 for v1.10.0 to',
  'v1.10.12; Apache-2.0 up to and including v1.9.5). See LICENSING.md for what that permits.',
  'The components below keep their own licences, and those licences are unaffected by ours.',
  '',
  `## Summary`,
  '',
  `${deps.length} production dependencies · ${images.length} container images.`,
  '',
  '## Container images',
  '',
  'Pinned in the self-host compose files. Each image carries the licence of its own project;',
  'consult the upstream repository named by the image for its terms.',
  '',
  ...images.map(i => `- \`${i}\``),
  '',
  '## npm dependencies',
  '',
  '| Package | Version | Licence |',
  '|---|---|---|',
  ...deps.map(d => `| ${d.name} | ${d.version} | ${d.licenseId} |`),
  '',
  '## Licence texts',
  '',
  'Grouped by identical text — the same licence is reproduced once, with the packages that ship it.',
  '',
];

let n = 0;
for (const { text, packages } of byText.values()) {
  n += 1;
  notices.push(`### ${n}. ${packages.map(p => `${p.name}@${p.version}`).join(', ')}`, '', '```', text, '```', '');
}

if (noText.length) {
  notices.push(
    '## Packages that ship no licence file',
    '',
    'Their `package.json` declares a licence but no text is included in the published tarball.',
    'Listed so the omission is visible rather than silent.',
    '',
    ...noText.map(d => `- ${d.name}@${d.version} — declared \`${d.licenseId}\``),
    '',
  );
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: 'sqemes', version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version },
  },
  components: [
    ...deps.map(d => ({
      type: 'library',
      name: d.name,
      version: d.version,
      purl: `pkg:npm/${d.name.replace('@', '%40')}@${d.version}`,
      ...(d.licenseId !== 'UNKNOWN' ? { licenses: [{ license: { id: d.licenseId } }] } : {}),
    })),
    ...images.map(i => {
      const [name, tag] = i.split(':');
      return { type: 'container', name, version: tag ?? 'latest', purl: `pkg:docker/${name}@${tag ?? 'latest'}` };
    }),
  ],
};

fs.writeFileSync(path.join(DEST, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'));
fs.writeFileSync(path.join(DEST, 'sbom.json'), JSON.stringify(sbom, null, 2) + '\n');

console.log(`→ THIRD_PARTY_NOTICES.md (${deps.length} packages, ${images.length} images)`);
console.log(`→ sbom.json (CycloneDX 1.5, ${sbom.components.length} components)`);
if (noText.length) console.log(`  ${noText.length} package(s) ship no licence file — listed in the notices`);
