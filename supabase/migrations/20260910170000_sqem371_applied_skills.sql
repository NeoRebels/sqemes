-- SQEM-371 — applied context belongs to the SESSION, not to whichever tab last touched it.
--
-- ⛔ Two silent defects prompted this, and the second is the expensive one:
--
--   1. `assistant_id` has been WRITE-ONLY since it was added. It is set when a session is created
--      and never read back, so reloading a session quietly dropped its assistant — and the header
--      chip vanished with it, leaving nothing to notice.
--   2. Switching sessions did not clear the client state, so an assistant applied in session A kept
--      governing session B — with the header actively confirming it as if intended. Not "something
--      is missing" but "something wrong is presented as right".
--
-- A skill was about to be turned into system context too (instead of pasted text), which would have
-- inherited both. Hence the column: the set of skills applied to this session, in the order they
-- were applied.
--
-- ⚠️ **No foreign key, and that is deliberate.** A `uuid[]` cannot carry one, and the alternative —
-- a join table — buys referential integrity we do not want here: deleting a template should not fail
-- because a chat once used it, and it should not cascade into rewriting session rows either. Ids
-- that no longer resolve are dropped when the session loads, which is also what happens when a
-- template becomes invisible through access control rather than deletion. The reader must tolerate
-- absence anyway, so integrity at the write end would be a false comfort.
--
-- ⚠️ Only skills. An assistant stays in `assistant_id`: exactly one, replacing the role. Flattening
-- both into one bag would lose that distinction, and the composition order depends on it.

alter table public.chat_sessions
  add column if not exists applied_skill_ids uuid[] not null default '{}';

comment on column public.chat_sessions.applied_skill_ids is
  'SQEM-371 — skills applied to this session, in application order. No FK on purpose: unresolvable '
  'ids are dropped on load, the same way an access-restricted template is. Assistants live in assistant_id.';

do $$
declare
  col_type text;
  col_default text;
begin
  -- Self-test, the pattern SQEM-335/351/352 established: prove the column is usable as intended
  -- rather than trusting that the statement ran.
  select data_type, column_default
    into col_type, col_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'chat_sessions'
     and column_name  = 'applied_skill_ids';

  if col_type is null then
    raise exception '[SQEM-371] applied_skill_ids was not created';
  end if;
  if col_type <> 'ARRAY' then
    raise exception '[SQEM-371] applied_skill_ids is %, expected an array', col_type;
  end if;
  if col_default is null then
    raise exception '[SQEM-371] applied_skill_ids has no default — existing rows would read as null';
  end if;

  -- The default has to hold for rows that already exist, or every session created before today
  -- would come back as null and the reader would have to guess. NOT NULL + default covers it;
  -- this asserts it rather than assuming.
  if exists (select 1 from public.chat_sessions where applied_skill_ids is null) then
    raise exception '[SQEM-371] existing sessions have a null applied_skill_ids';
  end if;
end $$;
