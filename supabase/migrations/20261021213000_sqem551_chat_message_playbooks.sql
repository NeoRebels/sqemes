-- SQEM-551 — a chat message remembers the playbooks around it.
--
-- playbook_ref        (user messages)      the prompt playbook the message was started from: id, title,
--                                          kind, the fields as filled in, and whether the text was
--                                          edited before sending. The title is a copy on purpose: a
--                                          deleted playbook keeps its card in the history.
-- loaded_template_ids (assistant messages) what the model loaded via get_template for exactly this
--                                          answer. Ids only — the client resolves titles from the
--                                          viewer's own playbook list, so a shared chat never shows
--                                          the name of a playbook the viewer cannot open.
--
-- Both are written by the client together with the message (as content is), under the existing
-- chat_messages_insert policy; no new policy and no new function. Older rows stay NULL and render as
-- before. The caps in lib/playbookRef.ts are the real limit; these CHECKs are the backstop.

alter table public.chat_messages
  add column playbook_ref jsonb,
  add column loaded_template_ids uuid[];

alter table public.chat_messages
  add constraint chat_messages_playbook_ref_shape check (
    playbook_ref is null
    or (role = 'user' and jsonb_typeof(playbook_ref) = 'object' and octet_length(playbook_ref::text) <= 65536)
  ),
  add constraint chat_messages_loaded_template_ids_shape check (
    loaded_template_ids is null
    or (role = 'assistant' and cardinality(loaded_template_ids) <= 20)
  );

comment on column public.chat_messages.playbook_ref is
  'SQEM-551 — user message: {id, title, kind, fields[{name,value}], edited} of the prompt playbook it was started from.';
comment on column public.chat_messages.loaded_template_ids is
  'SQEM-551 — assistant message: playbooks the model loaded (get_template) for this answer. Ids only.';
