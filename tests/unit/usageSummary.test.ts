import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseUsageSummary, usageLine } from '../../lib/usageSummary';

/**
 * SQEM-553 — usage numbers on the Overview's channel cards. The rights are tested against a real
 * database in tests/isolation/usageSummary.test.ts; here: the line the card shows, and the wiring.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('SQEM-553 — parsing the summary', () => {
  it('one entry per known channel; bigints as strings are numbers; odd rows are dropped', () => {
    expect(parseUsageSummary([
      { channel: 'mcp', uses: '41', top_template_id: A, top_uses: '12' },
      { channel: 'chat', uses: 2, top_template_id: null, top_uses: 0 },
      { channel: 'fax', uses: 9 },
      { channel: 'extension', uses: 'many' },
      null,
    ])).toEqual({
      mcp: { uses: 41, topTemplateId: A, topUses: 12 },
      chat: { uses: 2, topTemplateId: null, topUses: 0 },
    });
    expect(parseUsageSummary(null)).toEqual({});
  });
});

describe('SQEM-553 — the line on a card', () => {
  const visible = new Map([[A, { title: 'Customer reply', kind: 'prompt' as const }]]);

  it('says "last 7 days" (UTC days), never "this week"; singular for one', () => {
    expect(usageLine({ uses: 41, topTemplateId: A, topUses: 12 }, visible)).toEqual({
      count: 41, label: 'uses · last 7 days', top: { id: A, title: 'Customer reply', uses: 12 },
    });
    expect(usageLine({ uses: 1, topTemplateId: A, topUses: 1 }, visible).label).toBe('use · last 7 days');
  });

  it('nothing used → a quiet sentence, no number, no top', () => {
    expect(usageLine(undefined, visible)).toEqual({ count: 0, label: 'No uses in the last 7 days', top: null });
  });

  it('⛔ a top playbook the viewer cannot open is left out, not named', () => {
    expect(usageLine({ uses: 5, topTemplateId: B, topUses: 5 }, visible).top).toBeNull();
  });
});

describe('SQEM-553 — wiring', () => {
  const overview = read('pages/Overview.tsx');
  it('loaded only for those who may see the Overview, and an error shows no number (not zero)', () => {
    expect(overview).toMatch(/if \(!allowed \|\| !workspace\.id\) return;\s*let cancelled = false;\s*fetchUsageSummary\(workspace\.id\)/);
    expect(overview).toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setUsage\(null\); \}\)/);
    expect(overview).toMatch(/if \(usage === null\) return null;/);
  });
  it('every channel card carries its usage block', () => {
    for (const ch of ['extension', 'mcp', 'chat']) expect(overview).toContain(`usageBlock('${ch}')`);
  });
  it('the API asks for the fixed window through the one RPC', () => {
    expect(read('lib/api/usage.ts')).toMatch(/rpc\('workspace_usage_summary', \{ p_workspace_id: workspaceId, p_days: USAGE_DAYS \}\)/);
  });
  it('the migration: definer with a fixed search_path, caller checked, clamped, anon revoked', () => {
    const sql = read('supabase/migrations/20261022033000_sqem553_workspace_usage_summary.sql');
    expect(sql).toMatch(/security definer\s*set search_path = public, pg_temp/);
    expect(sql).toMatch(/if auth\.uid\(\) is null or p_workspace_id is null or not exists/);
    expect(sql).toMatch(/m\.role in \('admin', 'editor'\)/);
    expect(sql).toMatch(/least\(greatest\(coalesce\(p_days, 7\), 1\), 90\)/);
    expect(sql).toMatch(/revoke all on function public\.workspace_usage_summary\(uuid, integer\) from public, anon;/);
  });
});
