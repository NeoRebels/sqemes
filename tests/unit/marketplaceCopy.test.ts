import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-519 (b) — copying a listing: the person is told what it brings, the bundle that is imported is
 * the one that was reviewed, and the copy records where it came from. These modules import the store or
 * Supabase, so they are read as source (see `tests-must-not-import-supabase`).
 */
const ROOT = resolve(__dirname, '../../');
/** JSX comments, then line comments, then block comments — in that order (a `//` line holding `/*`). */
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const fn = (src: string, start: string) => { const s = src.slice(src.indexOf(start)); return s.slice(0, s.indexOf('\nexport ', 1)); };

const LIB = code('lib/api/library.ts');
const COPY = fn(LIB, 'export async function copyListingToWorkspace');

describe('the bundle that is imported is the one that was reviewed', () => {
  it('⛔ both copy paths (Cloud and self-host) read the bundle through the hash check, never readBundle directly', () => {
    expect(COPY.match(/readVerifiedBundle\(blob, listing\.id\)/g)).toHaveLength(2);
    expect(COPY).not.toMatch(/readBundle\(/);
  });

  it('the check compares against a freshly read bundle_hash and refuses before importing', () => {
    const verify = fn(LIB, 'async function readVerifiedBundle');
    expect(verify).toMatch(/bundleMatches\(read\.zip, await expectedBundleHash\(listingId\)\)/);
    expect(verify).toMatch(/throw new Error\(BUNDLE_CHANGED\(\)\)/); // SQEM-611 — a function: the text follows the app language
    expect(fn(LIB, 'async function expectedBundleHash')).toMatch(/select\('bundle_hash'\)/);
  });
});

describe('provenance', () => {
  it('a Cloud bundle copy records the listing on every template it creates', () => {
    expect(COPY).toMatch(/importBundle\(zip, manifest, workspaceId, userId, \{ sourceTemplateId: listing\.id \}\)/);
    expect(code('lib/templateBundle.ts')).toMatch(/buildPrompt\(bt, workspaceId, userId, mapFiles\(bt\.contextFileRefs\), opts\.sourceTemplateId\)/);
  });

  it('⛔ self-host records none — source_template_id FKs to library_templates, and the Cloud id is not a row there', () => {
    const selfHost = COPY.slice(0, COPY.indexOf('return;'));
    expect(selfHost).toMatch(/importBundle\(zip, manifest, workspaceId, userId\);/);
  });

  it('createPrompt writes it (so "Adapt" finally keeps its source); updates never do', () => {
    const prompts = code('lib/api/prompts.ts');
    expect(fn(prompts, 'export async function createPrompt')).toMatch(/row\.source_template_id = prompt\.sourceTemplateId/);
    const toRow = prompts.slice(prompts.indexOf('function promptToRow'));
    expect(toRow.slice(0, toRow.indexOf('\n}\n'))).not.toMatch(/source_template_id/);
  });
});

describe('what the person is told before adding it', () => {
  const VIEW = code('components/marketplace/ListingView.tsx');

  it('scripts, other files or web addresses turn "Add to playbooks" into two clicks', () => {
    expect(VIEW).toMatch(/summary\.scripts > 0 \|\| summary\.binaries > 0 \|\| summary\.hosts\.length > 0/);
    expect(VIEW).toMatch(/onClick=\{needsConfirm \? \(\) => setConfirming\(true\) : onCopy\}/);
    expect(VIEW).toMatch(/data-testid="copy-summary"/);
  });

  it('the public feed hands out the summary and the hash, never file_review itself', () => {
    const pub = code('supabase/functions/marketplace-public/index.ts');
    expect(pub).toMatch(/const \{ bundle_path, file_review, \.\.\.rest \}/);
    expect(pub).toMatch(/copy_summary: copySummaryOf\(/);
    expect(pub).toMatch(/select\(`\$\{DETAIL_COLS\}, bundle_path, file_review, bundle_hash`\)/);
    expect(pub).toMatch(/return \{ \.\.\.rest, \.\.\.copy, published: true, has_bundle: !!bundle_path \};/);
  });
});
