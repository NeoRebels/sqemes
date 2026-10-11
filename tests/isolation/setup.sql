-- SQEM-504 — test-only helper, created in the LOCAL database by the isolation suite and never by a
-- migration. It runs one statement as a client role with a given user's JWT claims and then rolls the
-- statement back, so probes cannot influence each other.
--
-- Returns 'rows=<n>' (a count for p_count, otherwise the affected row count) or 'err=<sqlstate> <msg>'.
create schema if not exists isolation_test;

drop function if exists isolation_test.probe(text, uuid, text, boolean);
-- p_setting: one GUC `name=value` set before the role switch. Used for `storage.allow_delete_query`:
-- storage.protect_delete() answers EVERY direct delete with 42501, the same code as a refusal, so
-- without it a delete probe on storage.objects would "pass" without testing RLS at all.
create or replace function isolation_test.probe(p_role text, p_uid uuid, p_stmt text, p_count boolean, p_setting text default null)
returns text
language plpgsql
as $$
declare
  n bigint;
  d text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_uid is null then json_build_object('role', p_role)::text
           else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    if p_setting is not null then
      perform set_config(split_part(p_setting, '=', 1), split_part(p_setting, '=', 2), true);
    end if;
    execute format('set local role %I', p_role);
    if p_count then
      execute p_stmt into n;
    else
      execute p_stmt;
      get diagnostics n = row_count;
    end if;
    -- Leave through an exception on purpose: it rolls back the statement, the role and the claims.
    raise exception using errcode = 'P0420', message = 'probe_done', detail = n::text;
  exception when others then
    get stacked diagnostics d = pg_exception_detail;
    if sqlstate = 'P0420' then
      return 'rows=' || d;
    end if;
    return 'err=' || sqlstate || ' ' || left(sqlerrm, 160);
  end;
end;
$$;
