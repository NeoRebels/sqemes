-- SQEM-594 — web search in sqemes Chat.
--
-- 1. chat_messages.web_sources (assistant messages)  {queries: [..], pages: [{url, title}]}
--    What an answer searched for and which pages it read — the line under the answer. Written by the
--    client together with the message, like library_changes (SQEM-561), under the existing
--    chat_messages_insert policy. ⛔ Never page content or result excerpts: raw results are not
--    stored anywhere (a workspace's own Brave key forbids storing results without "storage rights",
--    and nothing needs them after the answer). The client caps both lists at 10; this CHECK is the
--    backstop.
--
-- 2. web_search_daily — searches per workspace and UTC day on the key sqemes pays for (Cloud). A
--    workspace with its own search key is not counted here: its key, its bill, no limit of ours.
--    ⛔ Service role only: RLS on, no policy, no grant. consume_web_search() is the only writer and
--    is executable by the service role alone.

alter table public.chat_messages
  add column web_sources jsonb;

alter table public.chat_messages
  add constraint chat_messages_web_sources_shape check (
    web_sources is null
    or (
      role = 'assistant'
      and jsonb_typeof(web_sources) = 'object'
      and octet_length(web_sources::text) <= 16384
    )
  );

comment on column public.chat_messages.web_sources is
  'SQEM-594 — assistant message: {queries, pages:[{url,title}]} the answer searched for and read. Never page content.';

create table public.web_search_daily (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day          date not null,
  count        integer not null default 0,
  primary key (workspace_id, day)
);

alter table public.web_search_daily enable row level security;

revoke all on public.web_search_daily from anon, authenticated;

comment on table public.web_search_daily is
  'SQEM-594 — web searches per workspace and UTC day on the sqemes-paid search key. Service role only.';

-- One search more for today, if the limit allows it. Atomic: two answers searching at the same moment
-- cannot both take the last search.
create or replace function public.consume_web_search(p_workspace_id uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.web_search_daily as d (workspace_id, day, count)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update
    set count = d.count + 1
    where d.count < p_limit
  returning d.count into v_count;
  return v_count is not null;
end;
$$;

revoke all on function public.consume_web_search(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_web_search(uuid, integer) to service_role;
