-- SQEM-639 — a persona names the connectors its role works with.
--
-- Since SQEM-635 every connector starts off in every chat. Somebody who always works with the same
-- persona — a WhatsApp analyst with its messaging connector — had to switch the same connector on in each
-- new chat. Decided 2026-11-03: the persona carries its connectors. Choosing it in Chat switches
-- them on for that session (the switches stay); over MCP the persona only NAMES them, because sqemes
-- cannot switch on a client's connectors and never hands out their credentials.
--
-- ⚠️ No foreign key, for the reason SQEM-635 gives for chat_sessions.connector_ids: a uuid[] cannot
-- carry one, deleting a connector must not fail or rewrite personas, and every reader drops ids that
-- no longer resolve.
--
-- Writable through the existing personas UPDATE policy (admin/editor, plus the per-persona edit rights
-- of SQEM-473). Unlike chat_sessions, personas have no per-column UPDATE grant (SQEM-492 protects their
-- ownership columns with the guard_client_owned_columns trigger instead), so no grant is needed — the
-- self-test below proves it rather than assuming it.
--
-- ⚠️ SQEM-644 (2026-11-03, an approved edit of a deployed migration — the self-test only, no schema
-- change): the privilege check fails only when `authenticated` may UPDATE/INSERT an existing column (`title`)
-- but not the new one — the case it exists for: a column-grant regime that forgot the new column. A freshly created database without the project's default grants (the "Supabase
-- Preview" check) grants nothing on the table at all; that is not this migration's fault, and failing
-- there made the Preview red on every PR. Existing databases ran the stricter version and passed.

alter table public.personas
  add column if not exists connector_ids uuid[] not null default '{}';

comment on column public.personas.connector_ids is
  'SQEM-639 — connectors the persona works with: switched on in Chat when it is chosen, named over MCP. '
  'No FK on purpose: unresolvable ids are dropped on read.';

do $$
declare
  col_type text;
  col_default text;
begin
  select data_type, column_default
    into col_type, col_default
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'personas'
     and column_name  = 'connector_ids';

  if col_type is null then
    raise exception '[SQEM-639] connector_ids was not created';
  end if;
  if col_type <> 'ARRAY' then
    raise exception '[SQEM-639] connector_ids is %, expected an array', col_type;
  end if;
  if col_default is null then
    raise exception '[SQEM-639] connector_ids has no default';
  end if;
  if has_column_privilege('authenticated', 'public.personas', 'title', 'UPDATE')
     and not has_column_privilege('authenticated', 'public.personas', 'connector_ids', 'UPDATE') then
    raise exception '[SQEM-639] authenticated cannot update personas.connector_ids';
  end if;
  if has_column_privilege('authenticated', 'public.personas', 'title', 'INSERT')
     and not has_column_privilege('authenticated', 'public.personas', 'connector_ids', 'INSERT') then
    raise exception '[SQEM-639] authenticated cannot insert personas.connector_ids';
  end if;
  if exists (select 1 from public.personas where connector_ids is null or cardinality(connector_ids) > 0) then
    raise exception '[SQEM-639] existing personas must start with no connectors';
  end if;
end $$;
