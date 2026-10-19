-- SQEM-525 — creating a persona from the browser failed for everyone since SQEM-505 (2026-10-10).
--
-- SQEM-505 added the tenant boundary to `can_access_persona` as
--   exists (select 1 from public.personas pe where pe.id = p_persona_id and pe.workspace_id in (…))
-- i.e. the function looks its own row up. `createPersona` writes with `insert(...).select()`, and
-- Postgres checks the SELECT policy (`personas_select` → can_access_persona) on the row RETURNING
-- hands back — a row this function cannot yet see from inside the same statement. The lookup found
-- nothing, the check failed, and every insert ended in `42501 new row violates row-level security
-- policy for table "personas"`: the editor's New, the wizard, duplicate and bundle import. Measured
-- locally on 2026-10-19: the same insert by an admin gives rows=1 without RETURNING and 42501 with it.
-- MCP's create_persona writes with the service role and never noticed.
--
-- The sister functions do not have the problem: `can_access_template` and `can_access_file` are
-- handed the workspace id and never look their own row up.
--
-- ⛔ The fix keeps the boundary and turns it round: refuse when the row IS found in a workspace the
-- caller is not a member of. A persona of another workspace is still refused for every caller.
-- A row that cannot be found yet (the one being inserted) passes this part, and `personas_select`
-- checks the row's own workspace_id against the caller's workspaces anyway. A persona id that does
-- not exist at all also passes it — harmless, there is no row behind it to reach.

CREATE OR REPLACE FUNCTION public.can_access_persona(p_persona_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    not exists (select 1 from public.personas pe
                where pe.id = p_persona_id and pe.workspace_id not in (select public.get_user_workspace_ids()))
    and (
    p_created_by = (select auth.uid())
    or (
      not exists (
        select 1 from public.persona_access pa
        where pa.persona_id = p_persona_id
          and pa.user_id is null and pa.group_id is null
      )
      and (
        not exists (select 1 from public.persona_access pa where pa.persona_id = p_persona_id)
        or public.is_named_on_persona(p_persona_id, (select auth.uid()))
      )
    )
    );
$function$;

DO $$
BEGIN
  IF position('get_user_workspace_ids' IN pg_get_functiondef('public.can_access_persona(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SQEM-525 self-check: can_access_persona lost the SQEM-505 membership check';
  END IF;
  IF position('workspace_id not in' IN pg_get_functiondef('public.can_access_persona(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SQEM-525 self-check: can_access_persona still requires its own row to be visible';
  END IF;
END $$;
