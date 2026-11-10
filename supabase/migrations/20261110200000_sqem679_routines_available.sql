-- SQEM-679 — can this instance run routines? True once both Vault entries `routines_tick()` needs exist
-- (`routine_dispatch_secret`, `routine_run_url`). Cloud sets them by hand per project; a self-hosted
-- instance gets them from `selfhost/init/apply.sh` on every start. The app shows Routines on self-host only
-- when this says true, so an operator on their own Supabase without them never sees routines that cannot run.
-- ⛔ Says yes or no, never a value: `vault.secrets` is read for the names only.

create or replace function public.routines_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct name) = 2
  from vault.secrets
  where name in ('routine_dispatch_secret', 'routine_run_url');
$$;

revoke all on function public.routines_available() from public, anon;
grant execute on function public.routines_available() to authenticated, service_role;
