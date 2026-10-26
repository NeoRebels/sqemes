-- SQEM-594 (addendum, owner 2026-10-26) — the included web search is a monthly allowance per plan,
-- not a flat daily cap: Solo 100, Team 1,000, Business 3,000 searches per credit period; managed
-- workspaces unlimited (as with credits). Only searches on the key sqemes pays for count; a workspace's
-- own search key is never counted.
--
-- ⭐ One source of truth: the allowance is decided HERE, from workspaces.plan / is_managed, and the
-- period is the AI-credit period (credits_period_start, rolled by ensure_credit_period, SQEM-434), so
-- the searches reset on the same day as the credits. constants.ts mirrors the numbers for display;
-- tests/unit/webSearchPlans.test.ts compares the two.
--
-- consume_web_search(uuid, integer) took its limit from the caller and is replaced, not altered — the
-- earlier migration already ran on staging.

drop function if exists public.consume_web_search(uuid, integer);

-- The allowance of a plan. NULL = unlimited.
create or replace function public.web_search_allowance(p_plan text, p_managed boolean)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_managed, false) then null
    when p_plan = 'Solo' then 100
    when p_plan = 'Team' then 1000
    when p_plan = 'Business' then 3000
    else 100
  end;
$$;

-- One search more in this credit period, if the plan allows it. Serialised per workspace so two answers
-- searching at the same moment cannot both take the last search.
create or replace function public.consume_web_search(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowance integer;
  v_from date;
  v_used integer;
begin
  perform pg_advisory_xact_lock(hashtext('web_search:' || p_workspace_id::text));

  select public.web_search_allowance(w.plan::text, w.is_managed), (w.credits_period_start at time zone 'utc')::date
    into v_allowance, v_from
  from public.workspaces w where w.id = p_workspace_id;
  if not found then return false; end if;

  if v_allowance is not null then
    select coalesce(sum(d.count), 0) into v_used
    from public.web_search_daily d
    where d.workspace_id = p_workspace_id and d.day >= v_from;
    if v_used >= v_allowance then return false; end if;
  end if;

  insert into public.web_search_daily as d (workspace_id, day, count)
  values (p_workspace_id, (now() at time zone 'utc')::date, 1)
  on conflict (workspace_id, day) do update set count = d.count + 1;
  return true;
end;
$$;

revoke all on function public.consume_web_search(uuid) from public, anon, authenticated;
grant execute on function public.consume_web_search(uuid) to service_role;

-- For the Overview: searches used in this credit period and the plan's allowance (NULL = unlimited).
-- Any member of the workspace; nobody else.
create or replace function public.workspace_web_search_usage(p_workspace_id uuid)
returns table (used integer, allowance integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_workspace_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  ) then
    raise exception 'not allowed to read usage of this workspace' using errcode = '42501';
  end if;

  return query
  select
    coalesce((select sum(d.count) from public.web_search_daily d
              where d.workspace_id = w.id and d.day >= (w.credits_period_start at time zone 'utc')::date), 0)::integer,
    public.web_search_allowance(w.plan::text, w.is_managed)
  from public.workspaces w
  where w.id = p_workspace_id;
end;
$$;

revoke all on function public.workspace_web_search_usage(uuid) from public, anon;
grant execute on function public.workspace_web_search_usage(uuid) to authenticated;

comment on table public.web_search_daily is
  'SQEM-594 — web searches per workspace and UTC day on the sqemes-paid search key; summed over the credit period against the plan allowance (web_search_allowance). Service role only.';
