-- Per-user prompt favourites (replaces shared is_favorite column on prompts)
create table public.user_prompt_favorites (
  user_id uuid not null references public.profiles on delete cascade,
  prompt_id uuid not null references public.prompts on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, prompt_id)
);

alter table public.user_prompt_favorites enable row level security;

create policy "user_prompt_favorites_select"
  on public.user_prompt_favorites for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_prompt_favorites_insert"
  on public.user_prompt_favorites for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_prompt_favorites_delete"
  on public.user_prompt_favorites for delete
  to authenticated
  using (user_id = auth.uid());
