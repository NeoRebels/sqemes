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
  // Currently empty. Add a GHSA here ONLY when it is genuinely non-applicable to Sqemes
  // and can't be fixed now — with rationale + a tracking ticket. (The prior react-router
  // RSC-CSRF entry was removed in SQEM-136: the react-router v8 upgrade fixed it at source.)
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
