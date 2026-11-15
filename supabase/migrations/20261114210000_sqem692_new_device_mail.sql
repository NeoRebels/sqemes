-- SQEM-692 — a mail when someone signs in on a device sqemes does not know for them yet, with a button to the
-- Devices card (SQEM-691).
--
-- How: the minute tick below looks for sessions created since its last look and, only when there are some,
-- calls the edge function `notify-new-sign-in` through pg_net. The function names each device the way the
-- card does (`_shared/userAgent.ts`), compares it with `known_devices` and sends the mail through Resend.
--
-- ⛔ No trigger on `auth.sessions`: an error there would block signing in. A cron job that fails sends no
-- mail and blocks nobody.
-- ⛔ No new secret and no new Vault entry, so no manual step for the operator: the tick reuses the routine
-- dispatch secret and derives the function's address from `routine_run_url` (same host, other function).
-- Without them (a self-host install without a service key) the tick does nothing.
-- ⚠️ A sign-in is checked two minutes after it happened, so the browser has stored its country
-- (`session_locations`, SQEM-691) by then; the country is part of what makes a device known.

create table if not exists public.known_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table public.known_devices enable row level security;
revoke all on table public.known_devices from public, anon, authenticated;
-- The edge function writes it with the service key; explicit, because a Supabase preview database has no
-- default grants (SQEM-644).
grant select, insert, update on table public.known_devices to service_role;

-- One row: how far the check has looked. No row means it never ran, and the first run records every open
-- session as known without a mail (the rollout must not send everyone a mail).
create table if not exists public.sign_in_check_state (
  id boolean primary key default true check (id),
  checked_until timestamptz not null
);
alter table public.sign_in_check_state enable row level security;
revoke all on table public.sign_in_check_state from public, anon, authenticated;

create or replace function public.claim_new_sign_ins()
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  language text,
  created_at timestamptz,
  user_agent text,
  ip text,
  city text,
  country text,
  bootstrap boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz := now() - interval '2 minutes';
  v_boot boolean := false;
begin
  -- The row lock makes two overlapping runs take turns; the second one finds nothing new.
  select st.checked_until into v_from from public.sign_in_check_state st for update;
  if not found then
    v_boot := true;
    insert into public.sign_in_check_state (id, checked_until) values (true, v_to);
  elsif v_to <= v_from then
    return;
  else
    update public.sign_in_check_state set checked_until = v_to;
  end if;

  return query
    select s.id, s.user_id, u.email::text, p.language, s.created_at, s.user_agent, host(s.ip), l.city, l.country, v_boot
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    left join public.session_locations l on l.session_id = s.id
    -- MCP clients (OAuth) are connected on a consent screen the person just saw; they are not a device.
    -- Read through jsonb so an auth schema without the column (an older self-host) does not break the check.
    where to_jsonb(s) ->> 'oauth_client_id' is null
      and coalesce(u.is_anonymous, false) = false
      and u.email is not null
      and (s.not_after is null or s.not_after > now())
      and (v_boot or (s.created_at > v_from and s.created_at <= v_to))
    order by s.created_at;
end;
$$;

-- Called every minute by cron: only when there are sessions to check does it wake the edge function.
create or replace function public.new_sign_in_tick()
returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_from timestamptz;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'routine_run_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'routine_dispatch_secret';
  if v_url is null or v_url !~ '/routine-run$' or v_secret is null or length(v_secret) < 32 then
    return false;
  end if;
  select checked_until into v_from from public.sign_in_check_state;
  if found and not exists (
    select 1 from auth.sessions s where s.created_at > v_from and s.created_at <= now() - interval '2 minutes'
  ) then
    return false;
  end if;
  perform net.http_post(
    url := regexp_replace(v_url, '/routine-run$', '/notify-new-sign-in'),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-routine-dispatch', v_secret),
    timeout_milliseconds := 60000);
  return true;
end;
$$;

revoke all on function public.claim_new_sign_ins() from public, anon, authenticated;
revoke all on function public.new_sign_in_tick() from public, anon, authenticated;
grant execute on function public.claim_new_sign_ins() to service_role;
grant execute on function public.new_sign_in_tick() to service_role;

-- cron.schedule replaces a job of the same name, so re-running this migration keeps one job.
select cron.schedule('new-sign-in-tick', '* * * * *', 'select public.new_sign_in_tick()');

-- SQEM-503 — the grants above, checked; a wrong one aborts the migration.
do $$
declare f text;
begin
  foreach f in array array['public.claim_new_sign_ins()', 'public.new_sign_in_tick()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'SQEM-692: % is callable by a client', f;
    end if;
  end loop;
  if not exists (select 1 from cron.job where jobname = 'new-sign-in-tick') then
    raise exception 'SQEM-692: the new-sign-in-tick job was not scheduled';
  end if;
end $$;
