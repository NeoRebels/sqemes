import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * SQEM-488 — a Sqemes admin can make a workspace managed from the plan screen (the Settings toggle
 * sits behind the very gate it would lift), and managed means unmetered, not just ungated.
 */
const ROOT = resolve(__dirname, '../../');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('SQEM-488 — the plan screen', () => {
  const screen = code(read('components/ChoosePlanScreen.tsx'));

  it('shows the switch only to a Sqemes admin, and only while the workspace is not managed', () => {
    expect(screen).toMatch(/\{isSqemesAdmin && !workspace\.isManaged && \(/);
  });

  it('uses the same store action as Settings — one server-checked RPC, no second path', () => {
    expect(screen).toMatch(/setWorkspaceManaged\(workspace\.id, true\)/);
    // It reads `workspaces` for the post-checkout poll; it must never write it or call the RPC itself.
    expect(screen).not.toMatch(/\.rpc\(|\.update\(|\.upsert\(/);
  });
});

describe('SQEM-488 — set_workspace_managed', () => {
  const sql = read('supabase/migrations/20260929220000_sqem488_managed_sets_credit_limit.sql').replace(/--.*$/gm, '');

  it('still refuses anyone who is not a Sqemes admin', () => {
    expect(sql).toMatch(/IF NOT public\.is_sqemes_admin\(\) THEN\s+RAISE EXCEPTION 'Access denied';/);
    expect(sql).toMatch(/SECURITY DEFINER/);
  });

  it('managed → unlimited credits; unmanaged → the plan allowance again', () => {
    expect(sql).toMatch(/credits_limit = CASE WHEN managed THEN 0 ELSE public\.plan_credit_limit\(plan\) END/);
  });
});
