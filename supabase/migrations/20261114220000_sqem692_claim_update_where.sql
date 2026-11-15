-- SQEM-692 — fix: `claim_new_sign_ins()` moved its watermark with an UPDATE without a WHERE clause. Called through
-- PostgREST, Supabase refuses that (pg-safeupdate, error 21000): the first run (an INSERT) worked and
-- every later run failed, so no sign-in after the rollout was checked. Same function, with `where id`.
-- `create or replace` keeps the grants of 20261114210000 (service_role only); the check below proves it.

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
    -- ⛔ With a WHERE: through the API (PostgREST) Supabase refuses an UPDATE without one (pg-safeupdate,
    -- error 21000), which is what every run after the first one hit.
    update public.sign_in_check_state set checked_until = v_to where id;
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

do $$
begin
  if has_function_privilege('authenticated', 'public.claim_new_sign_ins()', 'execute')
     or has_function_privilege('anon', 'public.claim_new_sign_ins()', 'execute') then
    raise exception 'SQEM-692: claim_new_sign_ins is callable by a client';
  end if;
end $$;
