-- SQEM-635 — connectors are switched on PER CHAT SESSION, and start off.
--
-- Since SQEM-436 every chat message carried every connector of the workspace. The model then called
-- them for tasks that did not need them: for one customer (2026-10-29) a request to lay out a report as
-- a PDF went past Claude's 1M tokens, almost certainly from connector results the
-- provider fetched itself — and every later message in that chat failed the same way. Decided
-- 2026-11-03: off for everyone by default, switched on for the session, not per message.
--
-- ⚠️ No foreign key, for the reason SQEM-371 gives for applied_skill_ids: a uuid[] cannot carry one,
-- deleting a connector must not fail or rewrite chat rows, and the reader drops ids that no longer
-- resolve anyway (a per-user connector of the session owner does not resolve for a collaborator).
--
-- ⚠️ Existing sessions start with none — deliberately, not as a side effect of the default: that is
-- the decision, and a session that silently kept "all on" would be the old behaviour by the back door.
--
-- Writable through the existing chat_sessions UPDATE policy (owner, or anyone in the workspace for a
-- shared session) — the same people who may already change its model and its applied skills.
-- ⛔ The policy is not enough on its own: since SQEM-492 UPDATE on chat_sessions is granted PER
-- COLUMN, so a new column the client writes needs its own grant, or every switch fails with a
-- permission error the UI swallows (updateAppliedContext is fire-and-forget).

alter table public.chat_sessions
  add column if not exists connector_ids uuid[] not null default '{}';

grant update (connector_ids) on public.chat_sessions to authenticated;

comment on column public.chat_sessions.connector_ids is
  'SQEM-635 — connectors switched on for this session (off by default). No FK on purpose: '
  'unresolvable ids are dropped on load, like applied_skill_ids.';

do $$
declare
  col_type text;
  col_default text;
begin
  select data_type, column_default
    into col_type, col_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'chat_sessions'
     and column_name  = 'connector_ids';

  if col_type is null then
    raise exception '[SQEM-635] connector_ids was not created';
  end if;
  if col_type <> 'ARRAY' then
    raise exception '[SQEM-635] connector_ids is %, expected an array', col_type;
  end if;
  if col_default is null then
    raise exception '[SQEM-635] connector_ids has no default';
  end if;
  if not has_column_privilege('authenticated', 'public.chat_sessions', 'connector_ids', 'UPDATE') then
    raise exception '[SQEM-635] authenticated cannot update connector_ids (SQEM-492 column grants)';
  end if;
  if exists (select 1 from public.chat_sessions where connector_ids is null or cardinality(connector_ids) > 0) then
    raise exception '[SQEM-635] existing sessions must start with no connectors switched on';
  end if;
end $$;
