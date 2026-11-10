-- SQEM-676 — Routines, part 3: the minute tick that starts due runs (epic SQEM-672).
--
-- Every minute: give silent runs their one retry (reap), queue what is due (enqueue), hand out free places up
-- to the cap of 150 (claim, SQEM-675), and start each claimed run by calling the `routine-run` edge function
-- through pg_net — from inside the database, the way SQEM-673 measured 200 runs at once finishing cleanly.
--
-- ⛔ The function's address and its secret live in the Vault, set by hand per project (a production step;
-- pm/PRODUCTION_PROMOTION.md in the source repository). Without them the tick does nothing at all — which is
-- also what a self-hosted instance gets until its installer sets them.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.routines_tick()
returns int
language plpgsql set search_path = public, extensions as $$
declare
  url text;
  secret text;
  c record;
  started int := 0;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'routine_run_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'routine_dispatch_secret';
  if url is null or secret is null or length(secret) < 32 then
    return 0;
  end if;

  perform public.reap_routine_runs();
  perform public.enqueue_due_routines();
  for c in select * from public.claim_routine_runs(150) loop
    perform net.http_post(
      url := url,
      body := jsonb_build_object('queueId', c.queue_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-routine-dispatch', secret),
      timeout_milliseconds := 60000);
    started := started + 1;
  end loop;
  return started;
end $$;

revoke all on function public.routines_tick() from public, anon, authenticated;
grant execute on function public.routines_tick() to service_role;

-- cron.schedule replaces a job of the same name, so re-running this migration keeps one job.
select cron.schedule('routines-tick', '* * * * *', 'select public.routines_tick()');

do $$
begin
  if has_function_privilege('authenticated', 'public.routines_tick()', 'execute')
     or has_function_privilege('anon', 'public.routines_tick()', 'execute') then
    raise exception 'SQEM-676: routines_tick is callable by a client';
  end if;
  if not exists (select 1 from cron.job where jobname = 'routines-tick') then
    raise exception 'SQEM-676: the routines-tick job was not scheduled';
  end if;
end $$;
