import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLANS } from '../../constants';

/**
 * SQEM-556 — the storage shown on the plan cards is display only; the enforced limit lives in the
 * database (SQEM-515). This holds the two together: change one, the test says which other to change.
 */
const ROOT = resolve(__dirname, '../..');
// ⚠️ The migration is Cloud-only and pruned from the self-host export — there the comparison is skipped
// (self-host has no storage limit and no plan cards), the rest of the file still runs.
const MIGRATION = join(ROOT, 'supabase/migrations/20261016170000_sqem515_storage_limit_cloud.sql');
const hasMigration = existsSync(MIGRATION);
const migration = hasMigration ? readFileSync(MIGRATION, 'utf8') : '';
const bytesFor = (plan: string) => {
  const m = migration.match(new RegExp(`when w\\.plan = '${plan}'\\s+then (\\d+)`));
  return m ? Number(m[1]) : null;
};
const soloBytes = Number(migration.match(/else\s+(\d+)\s+--\s+1 GB \(Solo/)?.[1]);

describe.skipIf(!hasMigration)('SQEM-556 — plan storage matches the enforced limit', () => {
  it.each([['Team'], ['Business']] as const)('%s', plan => {
    expect(PLANS[plan].storageGb * 1024 ** 3).toBe(bytesFor(plan));
  });

  it('Solo (the default branch)', () => {
    expect(PLANS.Solo.storageGb * 1024 ** 3).toBe(soloBytes);
  });

});

describe('SQEM-556 — the plan cards', () => {
  it('every plan card names its storage', () => {
    for (const [tier, p] of Object.entries(PLANS)) {
      expect(p.features, tier).toContain(`${p.storageGb} GB file storage`);
    }
  });

  it('the current plan card in Settings shows the usage bar', () => {
    expect(readFileSync(join(ROOT, 'pages/Settings.tsx'), 'utf8')).toMatch(/\{isActivePlan && <div className="mt-5"><PlanStorageUsage workspaceId=\{workspace\.id\} \/><\/div>\}/);
  });
});
