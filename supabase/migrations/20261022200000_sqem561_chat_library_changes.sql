-- SQEM-561 — an answer in sqemes Chat remembers what it changed in the library.
--
-- library_changes (assistant messages)  [{action, kind, id, title}] — one entry per playbook, persona
--                                       or file the model created, updated or deleted for exactly
--                                       this answer (created|updated|deleted × prompt|skill|persona|file).
--
-- The changes themselves are made by the chat function with the shared MCP handlers, under the
-- chat user's role and edit rights (can_edit_*); this column is only the card under the answer.
-- Written by the client together with the message, like loaded_template_ids (SQEM-551), under the
-- existing chat_messages_insert policy; no new policy and no new function. Older rows stay NULL.
-- The title is stored so a deleted object keeps a name; the client shows the viewer's own current
-- title where it can (changeLabel in supabase/functions/_shared/libraryChanges.ts). The client caps the list at
-- 20 entries and each title at 200 characters; this CHECK is the backstop.

alter table public.chat_messages
  add column library_changes jsonb;

alter table public.chat_messages
  add constraint chat_messages_library_changes_shape check (
    library_changes is null
    or (
      role = 'assistant'
      and jsonb_typeof(library_changes) = 'array'
      and jsonb_array_length(library_changes) <= 20
      and octet_length(library_changes::text) <= 32768
    )
  );

comment on column public.chat_messages.library_changes is
  'SQEM-561 — assistant message: [{action, kind, id, title}] the model changed in the library for this answer.';
