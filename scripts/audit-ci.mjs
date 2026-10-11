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
  // ── SQEM-498 (2026-10-07) ──────────────────────────────────────────────────────────────────
  // braces ≤ 3.0.3 has NO patched version. It reaches us only through Tailwind 3's build chain
  // (tailwindcss → micromatch / fast-glob / chokidar): it runs at build and dev time, never in the
  // shipped bundle and never in an edge function (Deno, no node_modules), and the patterns it
  // expands are the content globs in our own tailwind.config — no untrusted input reaches it.
  // Revisit when: braces ships a fix (the nightly audit runs with AUDIT_STRICT_ALLOWLIST=1 and turns
  // red the morning this entry stops matching), or with a move to Tailwind 4, which drops the chain.
  ['GHSA-vfj7-8cjw-p6xm', 'braces (high, no fix) — Tailwind 3 build chain only; repo-owned globs; SQEM-498'],
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
