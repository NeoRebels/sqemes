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
  // React Router "RSC Mode CSRF Bypass" (react-router 7.12.0–8.2.0). Only affects React
  // Server Components mode; Sqemes is a client-side Vite SPA (HashRouter, no RSC), so the
  // vulnerable server-action path is never executed. Fixed upstream only in react-router
  // v8 — the v8 migration is tracked in SQEM-136. Revisit on every react-router bump.
  ['GHSA-qwww-vcr4-c8h2', 'react-router RSC-mode CSRF — not reachable in a client SPA (SQEM-136)'],
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
