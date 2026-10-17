-- SQEM-517 — how often a playbook is used, per workspace, day and channel. The ground for analytics.
--
-- ⛔ **Counted, never attributed to a person** (a deliberate decision). One row per workspace × UTC day ×
-- channel × action × playbook, with a count — no user id, no content. A per-employee view would, in a
-- German company, usually need the works council (§ 87 Abs. 1 Nr. 6 BetrVG: a technical device able to
-- monitor behaviour or performance); that is a deliberate decision for later, not something to add in
-- passing. ⚠️ For a Solo workspace the numbers still relate to one person — which is why the privacy
-- policy names them.
--
-- Channels: `extension` (reported by the browser extension through `record-usage`), `mcp` and `chat`
-- (counted by the server where the playbook is loaded — no client involved).
-- Clients cannot read this yet; the analytics ticket opens it for admins when there is a view for it.
-- Exported to self-host as well: an operator gets the same ground for their own analytics.
-- Kept 25 months (year-on-year comparison), then deleted by a pg_cron job where pg_cron exists.

create table if not exists public.usage_daily (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day          date not null,
  channel      text not null check (channel in ('extension', 'mcp', 'chat')),
  action       text not null check (action in ('playbook_inserted', 'playbook_loaded')),
  -- A deleted playbook takes its counts with it: the numbers are about playbooks that exist, and a
  -- count for something nobody can identify any more is noise for the analytics it is collected for.
  template_id  uuid not null references public.prompts (id) on delete cascade,
  count        integer not null default 0 check (count >= 0),
  primary key (workspace_id, day, channel, action, template_id)
);
create index if not exists usage_daily_day on public.usage_daily (day);
comment on table public.usage_daily is
  'SQEM-517 — playbook use per workspace, UTC day, channel and action. Counted, never per person. '
  'Written only by bump_usage() (service role); no client access until the analytics view exists. '
  'Kept 25 months.';

alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from anon, authenticated;

-- The only writer. The callers (edge functions, service key) have already checked that the playbook
-- belongs to the workspace and that the caller may see it; this re-checks the workspace match so a
-- wrong pair can never be counted under another tenant.
create or replace function public.bump_usage(p_ws uuid, p_channel text, p_action text, p_template uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.prompts p where p.id = p_template and p.workspace_id = p_ws) then
    return;
  end if;
  insert into public.usage_daily as u (workspace_id, day, channel, action, template_id, count)
  values (p_ws, (now() at time zone 'utc')::date, p_channel, p_action, p_template, 1)
  on conflict (workspace_id, day, channel, action, template_id) do update set count = u.count + 1;
end $$;

revoke all on function public.bump_usage(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.bump_usage(uuid, text, text, uuid) to service_role;

-- Retention: 25 months, where pg_cron exists (it is not enabled everywhere, e.g. a local stack).
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('purge-usage-daily', '15 4 1 * *',
      $q$delete from public.usage_daily where day < (now() at time zone 'utc')::date - interval '25 months'$q$);
  else
    raise warning 'SQEM-517: pg_cron unavailable — usage_daily is not purged automatically here';
  end if;
end $$;

-- Self-check (SQEM-503): no client may write or call.
do $$
begin
  if has_function_privilege('authenticated', 'public.bump_usage(uuid, text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.bump_usage(uuid, text, text, uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.usage_daily', 'select')
     or has_table_privilege('authenticated', 'public.usage_daily', 'insert') then
    raise exception 'SQEM-517 self-check: a client role can reach usage_daily';
  end if;
end $$;
