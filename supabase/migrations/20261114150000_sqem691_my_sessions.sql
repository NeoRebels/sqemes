-- SQEM-691 — "Devices" in the profile: a person sees where they are signed in and can end any other
-- session. Supabase already records every session in `auth.sessions` (user agent, IP, created, last
-- refreshed; every row measured carried a real client IP). It records no place,
-- so the place comes from the app: on Cloud a Vercel function reads the city and country Vercel derives
-- from the request, and the browser stores them for its own session here. Self-host has no such source
-- and shows "location unknown".
--
-- ⛔ Three functions, one boundary: every one of them acts only on `auth.uid()`'s own rows. Nobody, an
-- admin included, reads or ends another person's sessions.
-- ⚠️ Ending a session deletes its row, so its refresh token stops working at once. The access token the
-- other device already holds stays valid until it expires (jwt_expiry 3600 s); the card says so.

create table if not exists public.session_locations (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  city text,
  country text,
  updated_at timestamptz not null default now()
);

-- Reached only through the definer functions below; no policy means no direct access.
alter table public.session_locations enable row level security;
revoke all on table public.session_locations from public, anon, authenticated;

create or replace function public.current_session_id()
returns uuid
language sql
stable
set search_path = public
as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

create or replace function public.list_my_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  last_active_at timestamptz,
  user_agent text,
  ip text,
  city text,
  country text,
  is_current boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.created_at,
    -- `refreshed_at` is a timestamp without time zone, written in UTC by GoTrue.
    greatest(s.updated_at, s.refreshed_at at time zone 'utc', s.created_at) as last_active_at,
    s.user_agent,
    host(s.ip) as ip,
    l.city,
    l.country,
    s.id = public.current_session_id() as is_current
  from auth.sessions s
  left join public.session_locations l on l.session_id = s.id
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
  order by (s.id = public.current_session_id()) desc nulls last, last_active_at desc;
$$;

create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  -- The own session is ended with the normal sign out, which also clears the browser.
  if p_session_id = public.current_session_id() then
    raise exception 'use sign out for the current session' using errcode = '22023';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  return found;
end;
$$;

create or replace function public.set_my_session_location(p_city text, p_country text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid uuid := public.current_session_id();
begin
  if auth.uid() is null or v_sid is null then
    return;
  end if;
  if not exists (select 1 from auth.sessions where id = v_sid and user_id = auth.uid()) then
    return;
  end if;
  insert into public.session_locations (session_id, user_id, city, country, updated_at)
  values (
    v_sid,
    auth.uid(),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(upper(left(btrim(coalesce(p_country, '')), 2)), ''),
    now()
  )
  on conflict (session_id) do update
    set city = excluded.city, country = excluded.country, updated_at = now();
end;
$$;

revoke all on function public.current_session_id() from public, anon, authenticated;
revoke all on function public.list_my_sessions() from public, anon, authenticated;
revoke all on function public.revoke_my_session(uuid) from public, anon, authenticated;
revoke all on function public.set_my_session_location(text, text) from public, anon, authenticated;
grant execute on function public.current_session_id() to authenticated, service_role;
grant execute on function public.list_my_sessions() to authenticated;
grant execute on function public.revoke_my_session(uuid) to authenticated;
grant execute on function public.set_my_session_location(text, text) to authenticated;

-- SQEM-503 — the grants above, checked; a wrong one aborts the migration.
do $$
declare f text;
begin
  foreach f in array array['public.list_my_sessions()', 'public.revoke_my_session(uuid)', 'public.set_my_session_location(text, text)'] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'SQEM-691: anon may execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'SQEM-691: authenticated may not execute %', f;
    end if;
  end loop;
end $$;
