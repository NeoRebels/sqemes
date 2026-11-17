-- SQEM-696 — unschedule two pg_cron jobs whose tables are gone.
--
-- `20260311000002` schedules `cleanup-expired-history-items` (daily 03:00, DELETE FROM history_items)
-- only when pg_cron already exists. `20260625000002` (SQEM-067) dropped that table and left the
-- unscheduling as a note, not as code. A fresh database is NOT affected: pg_cron is created only by
-- `20261109210000`, long after, so the job is never scheduled there. Only a database that already had
-- pg_cron when `20260311000002` ran can still carry it. The same note names
-- `cleanup-result-images-daily`; no migration schedules it, it is removed here too in case it was set
-- up by hand.
--
-- ⚠️ `cron.unschedule(name)` raises when the name does not exist, so every job is looked up first;
-- without pg_cron there is no `cron` schema at all, so that is checked before anything else.
-- `raise warning`, not `notice`: notices are recorded nowhere (log_min_messages = warning), and the
-- line is the only trace of what this migration found.

do $$
declare
  v_job text;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  foreach v_job in array array['cleanup-expired-history-items', 'cleanup-result-images-daily'] loop
    if exists (select 1 from cron.job where jobname = v_job) then
      perform cron.unschedule(v_job);
      raise warning 'SQEM-696: unscheduled %', v_job;
    end if;
  end loop;
  if exists (select 1 from cron.job where jobname in ('cleanup-expired-history-items', 'cleanup-result-images-daily')) then
    raise exception 'SQEM-696: an orphaned cleanup job is still scheduled';
  end if;
end $$;
