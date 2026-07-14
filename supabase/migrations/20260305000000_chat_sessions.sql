-- ============================================================
-- Chat Sessions & Messages
-- ============================================================

-- -------------------- CHAT SESSIONS --------------------
create table public.chat_sessions (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces on delete cascade,
  user_id        uuid not null references public.profiles on delete cascade,
  title          text not null default 'New Chat',
  model          text not null default '',
  assistant_id   uuid references public.assistants on delete set null,
  visibility     text not null default 'private'
                   check (visibility in ('private', 'workspace')),
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- -------------------- CHAT MESSAGES --------------------
create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  model      text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- User's sessions ordered by most recent activity
create index idx_chat_sessions_user
  on public.chat_sessions (workspace_id, user_id, last_active_at desc);

-- Shared sessions visible to workspace members
create index idx_chat_sessions_shared
  on public.chat_sessions (workspace_id, visibility)
  where visibility = 'workspace';

-- Messages for a session in chronological order
create index idx_chat_messages_session
  on public.chat_messages (session_id, created_at asc);

-- ============================================================
-- RLS
-- ============================================================
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Sessions: visible if you own it, or it's shared within your workspace
create policy "chat_sessions_select"
  on public.chat_sessions for select
  using (
    user_id = auth.uid()
    or (
      visibility = 'workspace'
      and workspace_id in (select public.get_user_workspace_ids())
    )
  );

create policy "chat_sessions_insert"
  on public.chat_sessions for insert
  with check (user_id = auth.uid());

create policy "chat_sessions_update"
  on public.chat_sessions for update
  using (user_id = auth.uid());

create policy "chat_sessions_delete"
  on public.chat_sessions for delete
  using (user_id = auth.uid());

-- Messages: readable if the parent session is visible to the user
create policy "chat_messages_select"
  on public.chat_messages for select
  using (
    session_id in (
      select id from public.chat_sessions
      where user_id = auth.uid()
         or (
           visibility = 'workspace'
           and workspace_id in (select public.get_user_workspace_ids())
         )
    )
  );

-- Only the session owner can insert messages
create policy "chat_messages_insert"
  on public.chat_messages for insert
  with check (
    session_id in (
      select id from public.chat_sessions where user_id = auth.uid()
    )
  );

-- ============================================================
-- PER-USER SESSION CAP (50 sessions per user per workspace)
-- ============================================================
create or replace function public.enforce_chat_session_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  excess int;
begin
  select count(*) - 50 into excess
  from public.chat_sessions
  where user_id = NEW.user_id
    and workspace_id = NEW.workspace_id;

  if excess >= 0 then
    -- Delete oldest session(s) by last_active_at to make room
    delete from public.chat_sessions
    where id in (
      select id from public.chat_sessions
      where user_id = NEW.user_id
        and workspace_id = NEW.workspace_id
      order by last_active_at asc
      limit excess + 1
    );
  end if;

  return NEW;
end;
$$;

create trigger enforce_chat_session_cap_trigger
  before insert on public.chat_sessions
  for each row execute function public.enforce_chat_session_cap();
