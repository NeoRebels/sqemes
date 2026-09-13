-- SQEM-393 — a person's favourite personas, the way `user_prompt_favorites` holds their favourite
-- playbooks (SQEM-087). Same shape on purpose: per user, per persona, own rows only, gone with either.
--
-- ⚠️ A second table rather than a `kind` column on the existing one: `user_prompt_favorites.prompt_id`
-- is a foreign key into `prompts`, and a persona is not a row there (SQEM-324 — "not a fourth
-- kind"). One table with a nullable pair of keys is the kind of shape that needs a check constraint
-- to say what it means; two tables say it in their names.

create table if not exists public.user_persona_favorites (
  user_id    uuid not null references public.profiles on delete cascade,
  persona_id uuid not null references public.personas on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, persona_id)
);

alter table public.user_persona_favorites enable row level security;

drop policy if exists "user_persona_favorites_select" on public.user_persona_favorites;
create policy "user_persona_favorites_select"
  on public.user_persona_favorites for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_persona_favorites_insert" on public.user_persona_favorites;
create policy "user_persona_favorites_insert"
  on public.user_persona_favorites for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_persona_favorites_delete" on public.user_persona_favorites;
create policy "user_persona_favorites_delete"
  on public.user_persona_favorites for delete
  to authenticated
  using (user_id = auth.uid());

do $$
declare
  n_policies int;
  rls_on     boolean;
begin
  -- Self-test (SQEM-335/351/352/371/389/390 pattern): prove the state the code will assume.
  if to_regclass('public.user_persona_favorites') is null then
    raise exception '[SQEM-393] user_persona_favorites was not created';
  end if;

  select relrowsecurity into rls_on from pg_class where oid = 'public.user_persona_favorites'::regclass;
  if not rls_on then
    raise exception '[SQEM-393] RLS is off on user_persona_favorites';
  end if;

  select count(*) into n_policies from pg_policies
   where schemaname = 'public' and tablename = 'user_persona_favorites';
  if n_policies <> 3 then
    raise exception '[SQEM-393] expected 3 policies on user_persona_favorites, found %', n_policies;
  end if;
end $$;
