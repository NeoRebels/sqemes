-- SQEM-676 — what the first load test with many routines due at once showed, fixed:
--
-- 1. A retry made a SECOND chat. `routine-run` created a chat per attempt, so a run that died and was retried
--    left one chat with only the prompt and "generating" forever. The queue row now remembers its chat
--    (`session_id`), and a retry writes into the same one.
-- 2. A run that died twice left that chat silent. `reap_routine_runs` now writes the failure into it
--    ("interrupted on the server"), marks it unseen and done, and the routine links to it.
-- 3. A failed run did not move `last_session_id`, so Routines would have linked to an older chat while the
--    newest one explained the failure. `finish_routine_run` now remembers the chat either way.
-- 4. `routines_tick(p_cap)`: the cap is a parameter, so a measurement can reschedule the job with another value
--    without a migration. The job keeps calling it without one (default below).
--
-- A new migration rather than edits: 20261109200000 and 20261109210000 were already applied.

alter table public.routine_queue add column if not exists session_id uuid references public.chat_sessions(id) on delete set null;

-- The failure text in the person's language (profile, then workspace, then English) — the reaper has no browser.
create or replace function public.routine_lost_text(p_user_id uuid, p_workspace_id uuid)
returns text
language sql stable set search_path = public as $$
  select case when coalesce((select language from public.profiles where id = p_user_id),
                            (select language from public.workspaces where id = p_workspace_id)) = 'de'
    then 'Diese Routine konnte nicht laufen: Der Lauf wurde auf dem Server abgebrochen, auch beim zweiten Versuch. Sie läuft zum nächsten Termin wieder.'
    else 'This routine could not run: the run was interrupted on the server, on the second attempt too. It runs again at its next time.'
  end;
$$;

create or replace function public.finish_routine_run(p_queue_id bigint, p_ok boolean, p_session_id uuid default null)
returns void
language plpgsql set search_path = public as $$
declare
  rid uuid;
begin
  delete from public.routine_queue where id = p_queue_id returning routine_id into rid;
  if rid is null then return; end if;
  update public.routines set last_session_id = coalesce(p_session_id, last_session_id) where id = rid;
  if p_ok then
    update public.routines set failure_count = 0 where id = rid;
  else
    perform public.routine_record_failure(rid);
  end if;
end $$;

create or replace function public.reap_routine_runs()
returns table (requeued int, failed int)
language plpgsql set search_path = public as $$
declare
  q record;
  re int := 0;
  fa int := 0;
begin
  for q in
    select * from public.routine_queue
    where state = 'running' and lease_until < now()
    for update skip locked
  loop
    if q.attempt < 2 then
      update public.routine_queue
        set state = 'queued', attempt = attempt + 1, lease_until = null, claimed_at = null
        where id = q.id;
      re := re + 1;
    else
      delete from public.routine_queue where id = q.id;
      if q.session_id is not null then
        insert into public.chat_messages (session_id, role, content)
          values (q.session_id, 'assistant', public.routine_lost_text(q.user_id, q.workspace_id));
        update public.chat_sessions set unseen = true, is_generating = false, last_active_at = now() where id = q.session_id;
        update public.routines set last_session_id = q.session_id where id = q.routine_id;
      end if;
      perform public.routine_record_failure(q.routine_id);
      fa := fa + 1;
    end if;
  end loop;
  return query select re, fa;
end $$;

drop function if exists public.routines_tick();
create or replace function public.routines_tick(p_cap int default 150)
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

do $$
declare f text;
begin
  foreach f in array array[
    'public.routine_lost_text(uuid, uuid)',
    'public.finish_routine_run(bigint, boolean, uuid)',
    'public.reap_routine_runs()',
    'public.routines_tick(int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'SQEM-676: % is callable by a client', f;
    end if;
  end loop;
end $$;

-- The job's command is unchanged (`select public.routines_tick()`); re-scheduled so it resolves the new signature.
select cron.schedule('routines-tick', '* * * * *', 'select public.routines_tick()');
