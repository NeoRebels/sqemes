-- SQEM-389 — a persona applied to a chat session lives ON the session, like the assistant and
-- the skills SQEM-371 put there.
--
-- A click on a persona card lands in Chat with the persona as the session's role: the composed
-- persona (role prose + the routing table, the same text `get_persona` serves over MCP) becomes
-- the system instruction, and the "Using:" strip shows it as a pill. Without this column the
-- pill would be tab state — gone on reload, leaking into the next session — the two defects
-- SQEM-371 fixed for assistants and skills.
--
-- ⚠️ A real foreign key here, unlike `applied_skill_ids` (an array cannot carry one). `on delete
-- set null`: deleting a persona must not fail because a chat once used it, and must not delete
-- the chat either — the session simply loses its role, which is what the reader tolerates anyway
-- (a persona made invisible by access control looks identical from the client).
--
-- ⚠️ One role per session. `persona_id` and `assistant_id` occupy the same slot; the client
-- clears one when it sets the other. Not enforced here with a check constraint on purpose: an
-- older client that only knows `assistant_id` must keep working against this schema, and a row
-- carrying both is resolved by the reader (persona wins), not rejected at the write.

alter table public.chat_sessions
  add column if not exists persona_id uuid references public.personas(id) on delete set null;

comment on column public.chat_sessions.persona_id is
  'SQEM-389 — the persona applied to this session (its composed role is the system instruction). '
  'Same slot as assistant_id; the client keeps them mutually exclusive, the reader prefers persona_id.';

do $$
declare
  col_type text;
  fk_count int;
begin
  -- Self-test, the pattern SQEM-335/351/352/371 established: prove the column is what the code
  -- expects rather than trusting that the statement ran.
  select data_type into col_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'chat_sessions' and column_name = 'persona_id';
  if col_type is null then
    raise exception '[SQEM-389] persona_id was not created';
  end if;
  if col_type <> 'uuid' then
    raise exception '[SQEM-389] persona_id is %, expected uuid', col_type;
  end if;

  select count(*) into fk_count
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
   where tc.table_schema = 'public' and tc.table_name = 'chat_sessions'
     and tc.constraint_type = 'FOREIGN KEY' and kcu.column_name = 'persona_id';
  if fk_count <> 1 then
    raise exception '[SQEM-389] persona_id carries % foreign keys, expected exactly 1 (→ personas)', fk_count;
  end if;
end $$;
