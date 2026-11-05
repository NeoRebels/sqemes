-- SQEM-641 — a persona names connector SERVICES, not one person's connector rows.
--
-- SQEM-639 (never released) stored `personas.connector_ids`: ids of connector rows. A
-- personal connector is one row PER PERSON with its own credentials, so an id saved by the author
-- switched nothing on for anybody else, and 639 could only offer shared connectors. Decided 2026-11-03:
-- everyone should see the service, use their own connection to it in Chat, and be told when they have
-- none. So the persona stores `[{ key, name }]` — the service key is computed by
-- `_shared/connectorService.ts` (`app:<provider>:<name>` or `url:<origin><path>`, never a query string).
--
-- ⚠️ `connector_ids` is dropped here. It was never released: this migration runs right after
-- 20261103170000 in the same release, so the column never carries real data. Nothing in the code reads it any more.
--
-- Writable through the personas UPDATE policy; personas have no per-column grants (SQEM-492 guards their
-- ownership columns by trigger), which the self-test proves rather than assumes.
--
-- ⚠️ SQEM-644 (2026-11-03, an approved edit of a deployed migration — the self-test only): the privilege
-- check fails only when `authenticated` may UPDATE/INSERT an existing column (`title`) but not this one. A fresh database without
-- the project's default grants (the "Supabase Preview" check) grants nothing on the table; failing there
-- made the Preview red on every PR. Existing databases ran the stricter version and passed.

alter table public.personas
  add column if not exists connectors jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'personas_connectors_is_array') then
    alter table public.personas
      add constraint personas_connectors_is_array check (jsonb_typeof(connectors) = 'array');
  end if;
end $$;

alter table public.personas drop column if exists connector_ids;

comment on column public.personas.connectors is
  'SQEM-641 — connector services the role works with: [{ key, name }]. In Chat each person''s own '
  'connection (or a shared one) is switched on; over MCP only the names are mentioned. No credentials.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'personas' and column_name = 'connectors'
                    and data_type = 'jsonb' and is_nullable = 'NO') then
    raise exception '[SQEM-641] personas.connectors missing or not a non-null jsonb';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'personas' and column_name = 'connector_ids') then
    raise exception '[SQEM-641] personas.connector_ids should be gone';
  end if;
  if (has_column_privilege('authenticated', 'public.personas', 'title', 'UPDATE')
        and not has_column_privilege('authenticated', 'public.personas', 'connectors', 'UPDATE'))
     or (has_column_privilege('authenticated', 'public.personas', 'title', 'INSERT')
        and not has_column_privilege('authenticated', 'public.personas', 'connectors', 'INSERT')) then
    raise exception '[SQEM-641] authenticated cannot write personas.connectors';
  end if;
  if exists (select 1 from public.personas where jsonb_typeof(connectors) <> 'array' or jsonb_array_length(connectors) > 0) then
    raise exception '[SQEM-641] existing personas must start with no connectors';
  end if;
end $$;
