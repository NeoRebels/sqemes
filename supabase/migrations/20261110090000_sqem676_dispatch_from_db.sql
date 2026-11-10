-- SQEM-676 — the answer of a routine run is started from the DATABASE, not from another edge function.
--
-- Measured in load tests: plain chat runs started through pg_net all finished with few workers booted, while
-- routine runs — `routine-run` calling `chat-message` over HTTP — lost a large share of a wave to "CPU Time
-- exceeded", with far more workers booted. A call from one edge function to another
-- lands on a freshly booted worker (seen before in SQEM-656), and `chat-message` is our heaviest module to boot.
--
-- So `routine-run` still prepares the run (chat, instruction, signed ticket) and then asks the database to send
-- the request: `routine_dispatch_chat` posts it through pg_net, the path that was measured healthy. The address
-- is derived from the Vault entry `routine_run_url`; the dispatch secret authorises the call at `chat-message`.

create or replace function public.routine_dispatch_chat(p_body jsonb, p_headers jsonb default '{}'::jsonb)
returns bigint
language plpgsql set search_path = public, extensions as $$
declare
  url text;
  secret text;
begin
  select replace(decrypted_secret, '/routine-run', '/chat-message') into url from vault.decrypted_secrets where name = 'routine_run_url';
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

revoke all on function public.routine_dispatch_chat(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.routine_dispatch_chat(jsonb, jsonb) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.routine_dispatch_chat(jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.routine_dispatch_chat(jsonb, jsonb)', 'execute') then
    raise exception 'SQEM-676: routine_dispatch_chat is callable by a client';
  end if;
end $$;
