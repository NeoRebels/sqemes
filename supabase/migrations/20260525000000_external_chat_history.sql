-- ============================================================
-- Private external AI chat history for the browser extension
-- ============================================================

create table if not exists public.external_chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  platform text not null,
  chat_key text not null,
  title text not null default '',
  url text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, chat_key),
  constraint external_chat_history_platform_not_empty check (char_length(trim(platform)) > 0),
  constraint external_chat_history_chat_key_not_empty check (char_length(trim(chat_key)) > 0),
  constraint external_chat_history_url_not_empty check (char_length(trim(url)) > 0)
);

create index if not exists idx_external_chat_history_user_last_seen
  on public.external_chat_history (user_id, last_seen_at desc);

create index if not exists idx_external_chat_history_user_pinned_last_seen
  on public.external_chat_history (user_id, pinned desc, last_seen_at desc);

alter table public.external_chat_history enable row level security;

create policy "external_chat_history_select_own"
  on public.external_chat_history for select
  to authenticated
  using (user_id = auth.uid());

create policy "external_chat_history_insert_own"
  on public.external_chat_history for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "external_chat_history_update_own"
  on public.external_chat_history for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "external_chat_history_delete_own"
  on public.external_chat_history for delete
  to authenticated
  using (user_id = auth.uid());
