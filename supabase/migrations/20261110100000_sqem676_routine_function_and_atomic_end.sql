-- SQEM-676 — two findings of a load test with routines and live chats at once:
--
-- 1. Routine runs and live chats shared `chat-message` and therefore its workers: a worker killed for CPU time
--    under routine load took live answers with it. Routine answers now go to `chat-routine`, the same
--    code under its own name, which Supabase runs on its own workers.
-- 2. Routine chats stayed silent although their run had finished: the worker died between "finish the run"
--    and "write the answer" — two calls with a window between them. `complete_routine_run` does both in ONE
--    transaction (queue row, answer, chat, routine), and only for the run that still owns its queue row.

create or replace function public.routine_dispatch_chat(p_body jsonb, p_headers jsonb default '{}'::jsonb)
returns bigint
language plpgsql set search_path = public, extensions as $$
declare
  url text;
  secret text;
begin
  select replace(decrypted_secret, '/routine-run', '/chat-routine') into url from vault.decrypted_secrets where name = 'routine_run_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'routine_dispatch_secret';
  if url is null or secret is null or length(secret) < 32 then
    raise exception 'SQEM-676: routine dispatch is not configured';
  end if;
  return net.http_post(
    url := url,
    body := p_body,
    headers := coalesce(p_headers, '{}'::jsonb) || jsonb_build_object('Content-Type', 'application/json', 'x-routine-dispatch', secret),
    timeout_milliseconds := 60000);
end $$;

-- The end of a run in one transaction. `p_pause = 'credits'`: no credits left — the routine waits, not a failure.
create or replace function public.complete_routine_run(
  p_queue_id bigint, p_ok boolean, p_session_id uuid, p_content text,
  p_loaded_template_ids uuid[] default null, p_web_sources jsonb default null, p_connector_ids uuid[] default null,
  p_pause text default null)
returns boolean
language plpgsql set search_path = public as $$
declare
  rid uuid;
begin
  delete from public.routine_queue where id = p_queue_id returning routine_id into rid;
  if rid is null then return false; end if; -- a retry or the reaper already ended this run
  insert into public.chat_messages (session_id, role, content, loaded_template_ids, web_sources)
    values (p_session_id, 'assistant', p_content,
            case when cardinality(p_loaded_template_ids) > 0 then p_loaded_template_ids end, p_web_sources);
  update public.chat_sessions
    set unseen = true, is_generating = false, last_active_at = now(),
        connector_ids = coalesce(p_connector_ids, connector_ids)
    where id = p_session_id;
  update public.routines set last_session_id = p_session_id where id = rid;
  if p_pause = 'credits' then
    update public.routines set paused_reason = 'credits' where id = rid;
  elsif p_ok then
    update public.routines set failure_count = 0 where id = rid;
  else
    perform public.routine_record_failure(rid);
  end if;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.routine_dispatch_chat(jsonb, jsonb)',
    'public.complete_routine_run(bigint, boolean, uuid, text, uuid[], jsonb, uuid[], text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'SQEM-676: % is callable by a client', f;
    end if;
  end loop;
end $$;
