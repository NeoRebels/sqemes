-- ============================================================
-- Collaborative Chat
-- ============================================================

-- 1. Add user_id to chat_messages (nullable — backward compat)
alter table public.chat_messages
  add column user_id uuid references public.profiles(id) on delete set null;

-- 2. Add is_generating flag to chat_sessions
alter table public.chat_sessions
  add column is_generating boolean not null default false;

-- 3. Enable Realtime for chat_messages
alter publication supabase_realtime add table chat_messages;

-- 4. Allow workspace members to INSERT messages into workspace-visible sessions
drop policy "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert"
  on public.chat_messages for insert
  with check (
    session_id in (
      select id from public.chat_sessions
      where user_id = auth.uid()
         or (visibility = 'workspace'
             and workspace_id in (select public.get_user_workspace_ids()))
    )
  );

-- 5. Allow workspace members to UPDATE workspace-visible sessions (for model + is_generating)
drop policy "chat_sessions_update" on public.chat_sessions;
create policy "chat_sessions_update"
  on public.chat_sessions for update
  using (
    user_id = auth.uid()
    or (visibility = 'workspace'
        and workspace_id in (select public.get_user_workspace_ids()))
  );
