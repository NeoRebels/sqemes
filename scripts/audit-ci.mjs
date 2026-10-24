#!/usr/bin/env node
// SQEM-135 — CI audit gate with a documented allowlist.
//
// Replaces `npm audit --audit-level=high` in CI. Fails the build on ANY high/critical
// advisory EXCEPT the GHSA IDs explicitly allowlisted below (with rationale). This lets
// us defer a specific, non-applicable advisory without silencing the whole gate — every
// other high/critical still turns CI red, exactly as before.
//
// Keep ALLOWLIST minimal and reviewed. Each entry MUST justify why the advisory does not
// apply to Sqemes and when it should be revisited.

import { execSync } from 'node:child_process';

const ALLOWLIST = new Map([
  // Add a GHSA here ONLY when it is genuinely non-applicable to Sqemes and can't be fixed now —
  // with rationale + a tracking ticket. Prefer a package.json override whenever a patched version
  // exists (SQEM-494/495/496). (The prior react-router RSC-CSRF entry was removed in SQEM-136.)
  //
  // SQEM-569 (2026-10-23) — the SQEM-498 braces entry (GHSA-vfj7-8cjw-p6xm) is gone: GitHub withdrew that
  // advisory on 2026-10-23, so it matched nothing and the strict nightly run would have turned red.
]);

let report;
try {
  // npm audit exits non-zero when vulnerabilities exist; capture stdout either way.
  report = JSON.parse(execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch (err) {
  if (!err.stdout) throw err;
  report = JSON.parse(err.stdout);
}

// Collect every distinct high/critical source advisory (GHSA) across the report.
const found = new Set();
for (const vuln of Object.values(report.vulnerabilities || {})) {
  for (const src of vuln.via || []) {
    if (typeof src === 'object' && src.url && (src.severity === 'high' || src.severity === 'critical')) {
      found.add(src.url.split('/').pop());
    }
  }
}

const offenders = [...found].filter((ghsa) => !ALLOWLIST.has(ghsa));

if (offenders.length) {
  console.error('✖ Audit gate FAILED — high/critical advisories not on the allowlist:\n');
  for (const ghsa of offenders) console.error(`  ${ghsa}  https://github.com/advisories/${ghsa}`);
  console.error('\nFix them, or (only if genuinely non-applicable) add to ALLOWLIST in scripts/audit-ci.mjs with rationale.');
  process.exit(1);
}

const allowed = [...ALLOWLIST.keys()].filter((g) => found.has(g));
console.log(`✓ Audit gate passed. High/critical: 0 unhandled` +
  (allowed.length ? `, ${allowed.length} allowlisted (${allowed.join(', ')}).` : '.'));

// SQEM-498 — an allowlist entry that no longer matches anything is an exception that outlived its
// reason. Reported always; fatal only where AUDIT_STRICT_ALLOWLIST=1 (the nightly audit), so a fix
// upstream raises an issue the next morning instead of blocking whoever happens to be merging.
const stale = [...ALLOWLIST.entries()].filter(([g]) => !found.has(g));
if (stale.length) {
  console.log(`\nℹ ${stale.length} allowlist entr${stale.length === 1 ? 'y' : 'ies'} no longer match a live advisory and can be removed:`);
  for (const [g, why] of stale) console.log(`  ${g} — ${why}`);
  if (process.env.AUDIT_STRICT_ALLOWLIST === '1') {
    console.error('\n✖ Strict allowlist: remove the stale entries above (the advisory is fixed or withdrawn).');
    process.exit(1);
  }
}
