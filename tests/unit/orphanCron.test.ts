import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261116210000_sqem696_unschedule_orphan_cron.sql'), 'utf8')
  .replace(/--.*$/gm, '');

describe('SQEM-696 — the orphaned cleanup jobs', () => {
  it('runs without pg_cron', () => {
    expect(sql).toContain("to_regclass('cron.job') is null");
  });
  it('looks a job up before unscheduling it, since unschedule raises on a missing name', () => {
    const lookup = sql.indexOf('select 1 from cron.job where jobname = v_job');
    const unschedule = sql.indexOf('cron.unschedule(v_job)');
    expect(lookup).toBeGreaterThan(-1);
    expect(unschedule).toBeGreaterThan(lookup);
  });
  it('covers both jobs and checks itself', () => {
    expect(sql).toContain("'cleanup-expired-history-items'");
    expect(sql).toContain("'cleanup-result-images-daily'");
    expect(sql).toMatch(/raise exception 'SQEM-696/);
  });
  it('leaves a trace that is actually recorded', () => {
    expect(sql).toMatch(/raise warning 'SQEM-696/);
    expect(sql).not.toMatch(/raise notice/i);
  });
});
