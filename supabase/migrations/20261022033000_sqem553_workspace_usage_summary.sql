-- SQEM-553 — the Overview's channel cards show usage: per channel, the sum of the last N UTC days and
-- the most used playbook. The ONLY way a client reads usage_daily (SQEM-517 gave clients no access).
--
-- ⛔ Aggregates only. Never a row of usage_daily, never a person (the table has none). Callable by
-- admins and editors of THAT workspace — the audience of the Overview. Everyone else, and a call
-- without a signed-in user, is refused (42501): the NULL trap of SQEM-505 is closed by checking
-- auth.uid() is not null explicitly, not by relying on a comparison that NULL would quietly fail.
--
-- The day is the UTC day, as bump_usage writes it; p_days is clamped to 1–90 so a caller cannot ask
-- for a scan of everything. The range uses the primary key (workspace_id, day, …).
--
-- The top playbook is an id; the browser resolves the title from the viewer's own list, so an editor
-- never learns the name of a playbook they cannot open (same rule as SQEM-551). Its COUNT does include
-- restricted playbooks — a workspace's usage total is not a secret from its admins and editors.

create or replace function public.workspace_usage_summary(p_workspace_id uuid, p_days integer default 7)
returns table (channel text, uses bigint, top_template_id uuid, top_uses bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_from date := (now() at time zone 'utc')::date - (v_days - 1);
begin
  if auth.uid() is null or p_workspace_id is null or not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid() and m.role in ('admin', 'editor')
  ) then
    raise exception 'not allowed to read usage of this workspace' using errcode = '42501';
  end if;

  return query
  with per_template as (
    select u.channel as ch, u.template_id as tid, sum(u.count)::bigint as n
    from public.usage_daily u
    where u.workspace_id = p_workspace_id and u.day >= v_from
    group by u.channel, u.template_id
  ), ranked as (
    select p.ch, p.tid, p.n,
           sum(p.n) over (partition by p.ch) as total,
           row_number() over (partition by p.ch order by p.n desc, p.tid) as rn
    from per_template p
  )
  select r.ch, r.total::bigint, r.tid, r.n from ranked r where r.rn = 1
  order by r.ch;
end;
$$;

revoke all on function public.workspace_usage_summary(uuid, integer) from public, anon;
grant execute on function public.workspace_usage_summary(uuid, integer) to authenticated;

comment on function public.workspace_usage_summary(uuid, integer) is
  'SQEM-553 — per channel: uses in the last p_days UTC days (1–90) and the most used playbook id. Admins/editors of the workspace only; aggregates, never persons.';
