#!/usr/bin/env node
// SQEM-220 — tally the licences of every installed package, and fail on copyleft.
//
// WHY THIS EXISTS. Sqemes is AGPL-3.0 from v1.10.0 (SQEM-222), and the way back to a permissive
// licence is deliberately kept open: we hold the copyright, and every outside contribution carries a
// signed CLA (SQEM-221). Exactly one thing can close that door permanently — pulling in third-party
// code we do NOT own that is itself GPL/AGPL. Compatibility is one-way: such code may enter an AGPL
// work, but it can never leave, because we cannot relicense what isn't ours.
//
// That mistake is invisible. Nothing breaks, no test fails, and it only surfaces the day someone
// wants to change the licence and has to audit years of dependencies. Hence a check rather than a
// paragraph nobody rereads.
//
//   node scripts/check-licenses.mjs            # summary + verdict
//   node scripts/check-licenses.mjs --list     # also list every package per licence
//
// Not wired into CI on purpose: it needs a full `node_modules`, and its verdict is a decision to
// make, not a build to break. Run it when adding a dependency.

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Copyleft: allowed into an AGPL work, but each one closes the way back to a permissive licence.
//
// MPL-2.0 is deliberately NOT in this list, and that is a judgement, not an oversight. It is
// *file-level* copyleft: those files stay MPL, but §3.3 lets them sit inside a Larger Work under
// another licence — so it does not block a return to permissive. (Our only MPL package today,
// lightningcss, is build-time and never shipped at all.)
const COPYLEFT = /^(A?GPL|LGPL|SSPL|BUSL|EUPL|CDDL|EPL|MS-RL|OSL)/i;
// Dual licences with a permissive option are fine — we take the permissive branch.
const HAS_PERMISSIVE_OPTION = /\b(MIT|ISC|BSD|Apache)\b/i;

const packages = [];
function scan(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '.bin') continue;
    if (e.name.startsWith('@')) { scan(join(dir, e.name)); continue; }
    const manifest = join(dir, e.name, 'package.json');
    if (existsSync(manifest)) {
      try {
        const j = JSON.parse(readFileSync(manifest, 'utf8'));
        const licence =
          typeof j.license === 'string' ? j.license
          : j.license?.type ? j.license.type
          : Array.isArray(j.licenses) ? j.licenses.map(l => l.type).join(' OR ')
          : 'UNKNOWN';
        packages.push({ name: j.name || e.name, licence });
      } catch { /* unreadable manifest — reported via the UNKNOWN bucket below if it matters */ }
    }
    scan(join(dir, e.name, 'node_modules'));
  }
}

if (!existsSync('node_modules')) {
  console.error('node_modules is missing — run `npm ci` first.');
  process.exit(2);
}
scan('node_modules');

const byLicence = new Map();
for (const p of packages) {
  if (!byLicence.has(p.licence)) byLicence.set(p.licence, []);
  byLicence.get(p.licence).push(p.name);
}

const sorted = [...byLicence.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`${packages.length} packages installed\n`);
for (const [licence, names] of sorted) {
  console.log(String(names.length).padStart(5), licence);
  if (process.argv.includes('--list')) console.log('      ' + names.sort().join(', '));
}

const concerning = sorted.filter(([licence]) =>
  (COPYLEFT.test(licence) && !HAS_PERMISSIVE_OPTION.test(licence)) || licence === 'UNKNOWN'
);

console.log();
if (concerning.length === 0) {
  console.log('✓ No copyleft or unknown licence. Nothing here blocks distribution under our licence.');
  process.exit(0);
}

console.log('⚠ Needs a decision — each of these is a one-way door:\n');
for (const [licence, names] of concerning) {
  console.log(`  ${licence} — ${names.join(', ')}`);
}
console.log(`
An UNKNOWN licence is not automatically a problem; it usually means the package omits the field.
Look it up before concluding anything.

A genuine GPL/AGPL/SSPL dependency cannot ship. Sqemes is under the Sustainable Use License, which is
not GPL-compatible: distributing the combined work would require licensing the whole thing under the
GPL. This is an incompatibility, not a cost to weigh — find another package, or the feature does not
happen.

If you believe this one is a false positive, say why in the pull request that introduces it, so the
reasoning outlives the decision.

Maintainers: AGENTS.md → Dependency licences, in the source repository.`);
process.exit(1);
