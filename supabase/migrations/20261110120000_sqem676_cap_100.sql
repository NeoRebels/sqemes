-- SQEM-676 — the queue cap goes from 150 to 100 runs at once. 150 was measured with plain chat calls (SQEM-673)
-- and lost routine runs to edge workers killed for CPU time; 100 lost none in the same measurement. At 2 min per
-- run, 100 carry ~750 runs per quarter hour. Raising it is a measurement first, then a migration — the steps are
-- in pm/DOCUMENTATION.md → Routines, "Raising the cap", in the source repository.
--
-- Rebuilt from the live definition; only the default changes. The job is rescheduled with its plain command.

create or replace function public.routines_tick(p_cap int default 100)
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
  for c in select * from public.claim_routine_runs(p_cap) loop
    perform net.http_post(
      url := url,
      body := jsonb_build_object('queueId', c.queue_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-routine-dispatch', secret),
      timeout_milliseconds := 60000);
    started := started + 1;
  end loop;
  return started;
end $$;

revoke all on function public.routines_tick(int) from public, anon, authenticated;
grant execute on function public.routines_tick(int) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.routines_tick(int)', 'execute')
     or has_function_privilege('anon', 'public.routines_tick(int)', 'execute') then
    raise exception 'SQEM-676: routines_tick is callable by a client';
  end if;
end $$;

select cron.schedule('routines-tick', '* * * * *', 'select public.routines_tick()');
