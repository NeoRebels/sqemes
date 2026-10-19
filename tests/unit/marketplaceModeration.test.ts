import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-519 — the moderator reads every file before approving, and nothing a submission carries is ever
 * rendered. The moderation surface is Cloud-only (stubbed in the self-host export), so these checks run
 * in the private repo only.
 */
const ROOT = resolve(__dirname, '../..');
const privateRepo = existsSync(resolve(ROOT, 'scripts/build-public-export.sh'));
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (s: string) => s.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');

describe.skipIf(!privateRepo)('moderation — read, never render', () => {
  const ui = code(read('components/MarketplaceAdminEntry.tsx'));
  const panel = ui.slice(ui.indexOf('function ListingReviewPanel'));

  it('⛔ source is shown as text in a <pre>, and the panel never injects markup', () => {
    expect(panel).toMatch(/<pre[^>]*data-testid="listing-source">\{sources\.get\(viewing\)\}<\/pre>/);
    expect(ui).not.toMatch(/dangerouslySetInnerHTML/);
    expect(panel).not.toMatch(/<iframe|<object|<embed|srcDoc|URL\.createObjectURL/);
  });

  it('approving goes through the panel with the confirmation and the reason', () => {
    expect(panel).toMatch(/onApprove\(\{ filesConfirmed, note \}\)/);
    expect(panel).toMatch(/const canApprove = \(!listing\.needsFileReview \|\| filesConfirmed\) && \(!high \|\| note\.trim\(\)\.length > 0\)/);
    expect(ui).not.toMatch(/handleModerate\(p\.id, 'approve'\)\}/); // no one-click approve any more
  });

  it('⛔ the AI opinion is shown as text and never feeds the approval (SQEM-519 B)', () => {
    const opinion = ui.slice(ui.indexOf('function AiOpinion'), ui.indexOf('function ListingReviewPanel'));
    expect(opinion).toMatch(/data-testid="ai-opinion"/);
    expect(panel).toMatch(/<AiOpinion review=\{listing\.aiReview\} \/>/);
    const gate = panel.slice(panel.indexOf('const canApprove'), panel.indexOf(';', panel.indexOf('const canApprove')));
    expect(gate).not.toMatch(/aiReview|verdict/);
    expect(read('supabase/migrations/20261017210000_sqem519b_ai_review.sql').replace(/--.*$/gm, '')).not.toMatch(/new\.ai_review->|ai_review->>'verdict'/);
  });

  it('the API sends the confirmation; the database decides (guard_listing_review)', () => {
    const api = code(read('lib/api/marketplaceAdmin.ts'));
    expect(api).toMatch(/\{ published: true, status: 'published', \.\.\.review \}/);
    expect(api).toMatch(/files_confirmed: !!opts\.filesConfirmed/);
    expect(read('supabase/migrations/20261017200000_sqem519_marketplace_file_review.sql')).toMatch(/hint = 'files_unconfirmed'/);
  });
});
