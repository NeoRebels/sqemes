-- SQEM-503 — least privilege for server-only SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on every new function to PUBLIC. The functions below are only called by the
-- edge functions (service role) or from inside other SECURITY DEFINER functions (which run as their
-- owner and are unaffected), so client roles lose EXECUTE on them. `increment_template_usage` is
-- called by the app and stays available to signed-in users. Functions used by RLS policies or by the
-- app are unchanged; the self-check below proves it.
--
-- Rule from here on: a new SECURITY DEFINER function states its EXECUTE grants explicitly in the same
-- migration (docs/ai/rules/database-migrations.md in the source repository).

DO $$
DECLARE
  fn text;
  server_only text[] := ARRAY[
    'public.mcp_accessible_template_ids(uuid, uuid)',
    'public.mcp_accessible_persona_ids(uuid, uuid)',
    'public.is_named_on_template(uuid, uuid, uuid)',
    'public.is_named_on_persona(uuid, uuid)',
    'public.check_and_increment_rate_limit(uuid, bigint, integer)',
    'public.check_mcp_rate_limit(uuid, text, integer)',
    'public.record_mcp_call(uuid, text)',
    'public.ensure_credit_period(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY server_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.increment_template_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_template_usage(uuid) TO authenticated, service_role;

-- Self-check: fail rather than ship a migration that did not take effect — and prove the functions
-- the app and RLS depend on were NOT caught by it.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.mcp_accessible_template_ids(uuid, uuid)', 'public.mcp_accessible_persona_ids(uuid, uuid)',
    'public.is_named_on_template(uuid, uuid, uuid)', 'public.is_named_on_persona(uuid, uuid)',
    'public.check_and_increment_rate_limit(uuid, bigint, integer)', 'public.check_mcp_rate_limit(uuid, text, integer)',
    'public.record_mcp_call(uuid, text)', 'public.ensure_credit_period(uuid)'
  ] LOOP
    IF has_function_privilege('authenticated', fn, 'execute') OR has_function_privilege('anon', fn, 'execute') THEN
      RAISE EXCEPTION 'SQEM-503: % is still callable by a client role', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'execute') THEN
      RAISE EXCEPTION 'SQEM-503: % is no longer callable by service_role', fn;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.increment_template_usage(uuid)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.increment_template_usage(uuid)', 'execute') THEN
    RAISE EXCEPTION 'SQEM-503: increment_template_usage grants are wrong';
  END IF;

  -- Used by RLS policies or called by the app: must stay callable for signed-in users.
  FOREACH fn IN ARRAY ARRAY[
    'public.can_access_template(uuid, uuid, uuid)', 'public.can_access_persona(uuid, uuid)',
    'public.can_access_file(uuid, uuid, uuid)', 'public.get_user_role(uuid)',
    'public.get_user_workspace_ids()', 'public.is_sqemes_admin()'
  ] LOOP
    IF NOT has_function_privilege('authenticated', fn, 'execute') THEN
      RAISE EXCEPTION 'SQEM-503: % must stay callable by authenticated (RLS / app)', fn;
    END IF;
  END LOOP;
END $$;
