-- SQEM-676 — exactly one result per run. In a load test, some chats held an answer AND the
-- "interrupted" text. Their lease ran out while the run was still working (the worker was starved), the
-- reaper retried or gave up, and the first run then wrote its answer anyway.
--
-- `finish_routine_run` now says whether this run still owned its queue row. `chat-message` and `routine-run`
-- write their result only when it did: whoever finishes first — the run, its retry or the reaper — is the
-- one result, and a late finisher writes nothing.
-- The return type changes (void → boolean), so the function is dropped and created again.

drop function if exists public.finish_routine_run(bigint, boolean, uuid);
create function public.finish_routine_run(p_queue_id bigint, p_ok boolean, p_session_id uuid default null)
returns boolean
language plpgsql set search_path = public as $$
declare
  rid uuid;
begin
  delete from public.routine_queue where id = p_queue_id returning routine_id into rid;
  if rid is null then return false; end if;
  update public.routines set last_session_id = coalesce(p_session_id, last_session_id) where id = rid;
  if p_ok then
    update public.routines set failure_count = 0 where id = rid;
  else
    perform public.routine_record_failure(rid);
  end if;
  return true;
end $$;

revoke all on function public.finish_routine_run(bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function public.finish_routine_run(bigint, boolean, uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.finish_routine_run(bigint, boolean, uuid)', 'execute') then
    raise exception 'SQEM-676: finish_routine_run is callable by a client';
  end if;
end $$;
