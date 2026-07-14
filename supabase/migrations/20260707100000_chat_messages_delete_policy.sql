-- SQEM-115 — allow deleting chat_messages so an edited-and-resent conversation can prune its
-- superseded tail (there was no DELETE policy, so client deletes were RLS-denied; only whole-session
-- deletes worked via FK cascade).
--
-- Deliberately narrow: a user may delete a message ONLY if it's in a session they OWN **and** it's
-- their own message or an unattributed/assistant message (`user_id IS NULL`). A collaborator's
-- message in a shared (workspace-visible) session — `user_id <> auth.uid()` — can never be deleted,
-- so edit-and-resend can't erase other people's contributions even if the client mis-targets it.
create policy "chat_messages_delete"
  on public.chat_messages for delete
  using (
    session_id in (select id from public.chat_sessions where user_id = auth.uid())
    and (user_id = auth.uid() or user_id is null)
  );
