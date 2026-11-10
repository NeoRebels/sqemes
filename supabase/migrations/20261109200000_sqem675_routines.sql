-- SQEM-675 — Routines, part 2 of SQEM-672: the data model, the schedule and the queue.
--
-- A routine is a personal, scheduled chat: one person creates it for themselves,
-- chooses which connectors it may use, and every run is a chat in their history. Nothing runs from this
-- migration alone — the cron job and the execution come in part 3.
--
-- ⛔ No execution log next to the chats (guardrail). `routine_queue` holds a row only while a run waits
-- or runs; it is deleted when the run ends. The chat is the record.
-- ⛔ The queue is capped: measured in load tests (SQEM-673), long runs started from inside the database held
-- up to a point, beyond it many were lost when edge workers exceeded their CPU time.

-- ── 1. routines ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.routines (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  prompt         text not null check (char_length(btrim(prompt)) between 1 and 20000),
  persona_id     uuid references public.personas(id) on delete set null,
  playbook_ids   uuid[] not null default '{}' check (cardinality(playbook_ids) <= 20),
  connector_ids  uuid[] not null default '{}' check (cardinality(connector_ids) <= 20),
  model          text check (model is null or char_length(model) <= 200),
  web_search     boolean not null default false,
  -- 1 = Monday … 7 = Sunday (ISO). Daily = all seven, weekly = one.
  days           smallint[] not null check (cardinality(days) between 1 and 7 and days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  time_of_day    time not null,
  time_zone      text not null,
  -- null = active. 'user' = paused by the person; 'failures' = three failed runs in a row; 'credits' = no credits left.
  paused_reason  text check (paused_reason in ('user', 'failures', 'credits')),
  failure_count  smallint not null default 0,
  next_run_at    timestamptz,
  last_session_id uuid references public.chat_sessions(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists routines_due_idx on public.routines (next_run_at) where paused_reason is null;
create index if not exists routines_owner_idx on public.routines (workspace_id, user_id);

-- ── 2. The next run, in the person's time zone ──────────────────────────────────────────────────────
-- The first moment after `p_after` whose local weekday is in `p_days` and whose local time is `p_time`.
-- ⚠️ Daylight saving: a local time that does not exist (spring forward) is read by Postgres as standard
-- time, i.e. one hour later on the clock — the next valid moment. A local time that exists twice (fall
-- back) maps to ONE instant, so the routine runs once. tests/isolation/routines.test.ts pins both.
create or replace function public.routine_next_run(p_days smallint[], p_time time, p_tz text, p_after timestamptz)
returns timestamptz
language plpgsql stable set search_path = public as $$
declare
  local_day date := (p_after at time zone p_tz)::date;
  candidate timestamptz;
begin
  for i in 0..8 loop
    if extract(isodow from local_day + i)::smallint = any(p_days) then
      candidate := ((local_day + i) + p_time) at time zone p_tz;
      if candidate > p_after then return candidate; end if;
    end if;
  end loop;
  return null;
end $$;

revoke all on function public.routine_next_run(smallint[], time, text, timestamptz) from public, anon;
grant execute on function public.routine_next_run(smallint[], time, text, timestamptz) to authenticated, service_role;

-- ── 3. Guard: what a client may write, the limit, the references, the schedule ─────────────────────
-- SECURITY INVOKER on purpose: the reference checks read personas, prompts and connectors under the
-- caller's RLS, so a routine can only point at what its owner may see.
create or replace function public.routines_guard()
returns trigger
language plpgsql set search_path = public as $$
declare
  client boolean := current_user in ('authenticated', 'anon');
  active int;
  visible int;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.workspace_id := old.workspace_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if client then
    if new.user_id is distinct from auth.uid() then
      raise exception 'SQEM-675: a routine belongs to the person who creates it' using errcode = '42501';
    end if;
    -- Server-owned columns: a client never writes them.
    if tg_op = 'INSERT' then
      new.failure_count := 0;
      new.last_session_id := null;
    else
      new.failure_count := old.failure_count;
      new.last_session_id := old.last_session_id;
    end if;
    -- A person may pause ('user') or resume (null); the other reasons are the server's.
    if new.paused_reason is not null and new.paused_reason <> 'user'
       and (tg_op = 'INSERT' or new.paused_reason is distinct from old.paused_reason) then
      raise exception 'SQEM-675: only the server pauses for failures or credits' using errcode = '42501';
    end if;
  end if;

  -- Resuming starts the failure count afresh.
  if new.paused_reason is null and (tg_op = 'INSERT' or old.paused_reason is not null) then
    new.failure_count := 0;
  end if;

  if not exists (select 1 from pg_timezone_names where name = new.time_zone) then
    raise exception 'SQEM-675: unknown time zone %', new.time_zone using errcode = '22023';
  end if;

  -- References stay in the workspace and within what the owner may see (RLS of the caller applies).
  if tg_op = 'INSERT' or new.persona_id is distinct from old.persona_id then
    if new.persona_id is not null and not exists (
      select 1 from public.personas p where p.id = new.persona_id and p.workspace_id = new.workspace_id) then
      raise exception 'SQEM-675: persona not found in this workspace' using errcode = '23503';
    end if;
  end if;
  if tg_op = 'INSERT' or new.playbook_ids is distinct from old.playbook_ids then
    select count(distinct p.id) into visible from public.prompts p
      where p.id = any(new.playbook_ids) and p.workspace_id = new.workspace_id;
    if visible <> cardinality(array(select distinct unnest(new.playbook_ids))) then
      raise exception 'SQEM-675: playbook not found in this workspace' using errcode = '23503';
    end if;
  end if;
  if tg_op = 'INSERT' or new.connector_ids is distinct from old.connector_ids then
    -- Personal connectors stay personal: only the workspace's shared ones and the owner's own.
    select count(distinct c.id) into visible from public.workspace_connectors c
      where c.id = any(new.connector_ids) and c.workspace_id = new.workspace_id
        and (c.user_id is null or c.user_id = new.user_id);
    if visible <> cardinality(array(select distinct unnest(new.connector_ids))) then
      raise exception 'SQEM-675: connector not found in this workspace' using errcode = '23503';
    end if;
  end if;

  -- At most 5 active routines per person and workspace (provisional, SQEM-672). The lock makes two
  -- tabs saving at once take turns instead of both counting four.
  if new.paused_reason is null and (tg_op = 'INSERT' or old.paused_reason is not null) then
    perform pg_advisory_xact_lock(hashtextextended('routines:' || new.workspace_id || ':' || new.user_id, 0));
    select count(*) into active from public.routines r
      where r.workspace_id = new.workspace_id and r.user_id = new.user_id and r.paused_reason is null
        and r.id is distinct from new.id;
    if active >= 5 then
      raise exception 'SQEM-675: at most 5 active routines per person' using errcode = 'P0001', hint = 'routine_limit';
    end if;
  end if;

  -- The schedule decides the next run; nobody writes it directly.
  if tg_op = 'INSERT' or new.days is distinct from old.days or new.time_of_day is distinct from old.time_of_day
     or new.time_zone is distinct from old.time_zone or (new.paused_reason is null and old.paused_reason is not null) then
    new.next_run_at := public.routine_next_run(new.days, new.time_of_day, new.time_zone, now());
  elsif client then
    new.next_run_at := old.next_run_at;
  end if;
  return new;
end $$;

revoke all on function public.routines_guard() from public, anon, authenticated;

drop trigger if exists routines_guard on public.routines;
create trigger routines_guard before insert or update on public.routines
  for each row execute function public.routines_guard();

-- ── 4. Rights: own routines only, while a member ───────────────────────────────────────────────────
alter table public.routines enable row level security;

drop policy if exists routines_own on public.routines;
create policy routines_own on public.routines for all to authenticated
  using (user_id = auth.uid() and public.get_user_role(workspace_id) is not null)
  with check (user_id = auth.uid() and public.get_user_role(workspace_id) is not null);

revoke all on public.routines from anon, authenticated;
grant select, delete on public.routines to authenticated;
grant insert (workspace_id, name, prompt, persona_id, playbook_ids, connector_ids, model, web_search,
              days, time_of_day, time_zone, paused_reason) on public.routines to authenticated;
grant update (name, prompt, persona_id, playbook_ids, connector_ids, model, web_search,
              days, time_of_day, time_zone, paused_reason) on public.routines to authenticated;
grant all on public.routines to service_role;

-- ── 5. Leaving the workspace drops the person's routines ───────────────────────────────────────────
-- A trigger of its own, next to on_workspace_member_removed, which stays untouched. DEFINER because the
-- person removing a member (an admin) cannot see that member's routines under RLS.
create or replace function public.routines_on_member_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.routines where workspace_id = old.workspace_id and user_id = old.user_id;
  return old;
end $$;

revoke all on function public.routines_on_member_removed() from public, anon, authenticated;

drop trigger if exists routines_member_removed on public.workspace_members;
create trigger routines_member_removed after delete on public.workspace_members
  for each row execute function public.routines_on_member_removed();

-- ── 6. Chats of a routine ──────────────────────────────────────────────────────────────────────────
alter table public.chat_sessions add column if not exists routine_id uuid references public.routines(id) on delete set null;
alter table public.chat_sessions add column if not exists unseen boolean not null default false;
create index if not exists chat_sessions_routine_idx on public.chat_sessions (routine_id) where routine_id is not null;

-- The person marks a routine's chat as seen; routine_id is the server's (no UPDATE grant).
grant update (unseen) on public.chat_sessions to authenticated;

-- INSERT on chat_sessions is a table-level grant, so a client could name a routine_id. It must be a
-- routine of the session's own person in the session's workspace — never someone else's.
create or replace function public.chat_sessions_routine_check()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.routine_id is not null and (tg_op = 'INSERT' or new.routine_id is distinct from old.routine_id) then
    if not exists (select 1 from public.routines r
                   where r.id = new.routine_id and r.workspace_id = new.workspace_id and r.user_id = new.user_id) then
      raise exception 'SQEM-675: routine not found for this chat' using errcode = '23503';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.chat_sessions_routine_check() from public, anon, authenticated;

drop trigger if exists chat_sessions_routine_check on public.chat_sessions;
create trigger chat_sessions_routine_check before insert or update of routine_id on public.chat_sessions
  for each row execute function public.chat_sessions_routine_check();

-- ── 7. The queue (server only) ─────────────────────────────────────────────────────────────────────
create table if not exists public.routine_queue (
  id           bigint generated by default as identity primary key,
  routine_id   uuid not null references public.routines(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  due_at       timestamptz not null,
  -- The local calendar day of the run: at most one run per routine and day.
  run_day      date not null,
  state        text not null default 'queued' check (state in ('queued', 'running')),
  attempt      smallint not null default 1,
  lease_until  timestamptz,
  claimed_at   timestamptz,
  unique (routine_id, run_day)
);

create index if not exists routine_queue_waiting_idx on public.routine_queue (due_at, id) where state = 'queued';
create index if not exists routine_queue_running_idx on public.routine_queue (lease_until) where state = 'running';

alter table public.routine_queue enable row level security;
revoke all on public.routine_queue from anon, authenticated;
grant all on public.routine_queue to service_role;

-- A missed time older than this is skipped, not caught up: a routine runs around its time and never early —
-- a morning briefing three hours late after an outage would be noise.
create or replace function public.enqueue_due_routines(p_grace interval default interval '30 minutes')
returns int
language plpgsql set search_path = public as $$
declare
  r record;
  queued int := 0;
  n int;
begin
  for r in
    select * from public.routines
    where paused_reason is null and next_run_at is not null and next_run_at <= now()
    order by next_run_at
    for update skip locked
  loop
    if now() - r.next_run_at <= p_grace then
      insert into public.routine_queue (routine_id, workspace_id, user_id, due_at, run_day)
      values (r.id, r.workspace_id, r.user_id, r.next_run_at, (r.next_run_at at time zone r.time_zone)::date)
      on conflict (routine_id, run_day) do nothing;
      get diagnostics n = row_count;
      queued := queued + n;
    end if;
    update public.routines
      set next_run_at = public.routine_next_run(r.days, r.time_of_day, r.time_zone, greatest(now(), r.next_run_at))
      where id = r.id;
  end loop;
  return queued;
end $$;

-- Hands out free places up to the cap, oldest due first. The lock makes concurrent calls take turns,
-- so two of them cannot both see the same free places.
create or replace function public.claim_routine_runs(p_cap int default 150, p_lease interval default interval '90 seconds')
returns table (queue_id bigint, routine_id uuid, workspace_id uuid, user_id uuid, attempt smallint, due_at timestamptz)
language plpgsql set search_path = public as $$
declare
  free int;
begin
  perform pg_advisory_xact_lock(hashtextextended('routine_claim', 0));
  select p_cap - count(*) into free from public.routine_queue q where q.state = 'running';
  if free <= 0 then return; end if;
  -- ⛔ A MATERIALIZED CTE, not `where id in (select … limit n for update skip locked)`: the planner may
  -- run that subquery more than once and update more rows than the limit (measured in the local test:
  -- 3 claimed with a cap of 2).
  return query
    with picked as materialized (
      select w.id from public.routine_queue w
      where w.state = 'queued'
      order by w.due_at, w.id
      limit free
      for update skip locked)
    update public.routine_queue q
      set state = 'running', claimed_at = now(), lease_until = now() + p_lease
      from picked
      where q.id = picked.id
      returning q.id, q.routine_id, q.workspace_id, q.user_id, q.attempt, q.due_at;
end $$;

-- A running run says it is alive; the lease moves on.
create or replace function public.routine_run_heartbeat(p_queue_id bigint, p_lease interval default interval '90 seconds')
returns boolean
language sql set search_path = public as $$
  update public.routine_queue set lease_until = now() + p_lease
  where id = p_queue_id and state = 'running'
  returning true;
$$;

-- A failed run: three in a row pause the routine.
create or replace function public.routine_record_failure(p_routine_id uuid)
returns void
language sql set search_path = public as $$
  update public.routines
    set failure_count = failure_count + 1,
        paused_reason = case when failure_count + 1 >= 3 then 'failures' else paused_reason end
  where id = p_routine_id;
$$;

-- A run ended: its queue row goes (no log), the routine remembers the chat or counts the failure.
create or replace function public.finish_routine_run(p_queue_id bigint, p_ok boolean, p_session_id uuid default null)
returns void
language plpgsql set search_path = public as $$
declare
  rid uuid;
begin
  delete from public.routine_queue where id = p_queue_id returning routine_id into rid;
  if rid is null then return; end if;
  if p_ok then
    update public.routines set failure_count = 0, last_session_id = coalesce(p_session_id, last_session_id) where id = rid;
  else
    perform public.routine_record_failure(rid);
  end if;
end $$;

-- Runs whose heartbeat stopped: once more, then a failure.
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
      perform public.routine_record_failure(q.routine_id);
      fa := fa + 1;
    end if;
  end loop;
  return query select re, fa;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.enqueue_due_routines(interval)',
    'public.claim_routine_runs(int, interval)',
    'public.routine_run_heartbeat(bigint, interval)',
    'public.routine_record_failure(uuid)',
    'public.finish_routine_run(bigint, boolean, uuid)',
    'public.reap_routine_runs()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'SQEM-675: % is callable by a client', f;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.routines', 'failure_count', 'update')
     or has_column_privilege('authenticated', 'public.routines', 'next_run_at', 'update')
     or has_column_privilege('authenticated', 'public.routines', 'user_id', 'update')
     or has_column_privilege('authenticated', 'public.chat_sessions', 'routine_id', 'update') then
    raise exception 'SQEM-675: a server-owned column is writable by clients';
  end if;
end $$;
