-- SQEM-595 — files sqemes Chat handed out with an answer.
--
-- chat_messages.generated_files (assistant messages)  [{name, format, content}] — the description of
-- each file: its name, the format (md|txt|docx|pdf|xlsx) and the document as Markdown. The file
-- itself is built in the browser when someone opens or downloads it (lib/fileExport.ts); nothing is
-- written to storage. Stored so the card is still there after a reload and for colleagues in a shared
-- chat. Written by the client with the message, under the existing chat_messages_insert policy, like
-- library_changes (SQEM-561) and web_sources (SQEM-594).
--
-- ⛔ Download only: this is part of the conversation, not a result store ("saved results" stays removed).
-- The client caps it at 5 files of 200,000 characters each; this CHECK is the backstop.

alter table public.chat_messages
  add column generated_files jsonb;

alter table public.chat_messages
  add constraint chat_messages_generated_files_shape check (
    generated_files is null
    or (
      role = 'assistant'
      and jsonb_typeof(generated_files) = 'array'
      and jsonb_array_length(generated_files) <= 5
      and octet_length(generated_files::text) <= 3145728
    )
  );

comment on column public.chat_messages.generated_files is
  'SQEM-595 — assistant message: [{name, format, content}] files handed out with this answer; built in the browser on download, never stored as files.';
