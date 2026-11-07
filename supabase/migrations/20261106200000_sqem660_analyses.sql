-- SQEM-660 step C — the "Analysis run" card under an answer, kept across a reload.
--
-- chat_messages.analyses (assistant messages)  [{ok}] — one entry per run_analysis program the answer
-- ran in the person's browser, and whether it worked. Stored so the card is still there after a reload
-- and for colleagues in a shared chat. Written by the client with the message, under the existing
-- chat_messages_insert policy, like generated_files (SQEM-595).
--
-- ⛔ Count and success ONLY (2026-11-06): no program, no reason, no output. A program can carry
-- values the model saw in the file's excerpt and a reason can quote a cell; both are shown live and
-- never stored. The tables themselves never leave the browser at all.
-- The client caps it at 6 entries (MAX_ANALYSES_PER_ANSWER); this CHECK is the backstop. ⚠️ A row the
-- CHECK refuses loses the whole answer, not only the card — so the client shapes it first
-- (storedAnalyses), and the size limit leaves room.

alter table public.chat_messages
  add column analyses jsonb;

alter table public.chat_messages
  add constraint chat_messages_analyses_shape check (
    analyses is null
    or (
      role = 'assistant'
      and jsonb_typeof(analyses) = 'array'
      and jsonb_array_length(analyses) <= 6
      and octet_length(analyses::text) <= 1024
    )
  );

comment on column public.chat_messages.analyses is
  'SQEM-660 — assistant message: [{ok}] one entry per analysis program run in the browser; count and success only, never the program or its data.';
