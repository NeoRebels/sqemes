-- SQEM-505 — the workspace boundary in four admin functions, three access helpers, and the
-- chat_sessions / profiles policies.
--
-- 1. Four admin functions compare the caller's role with `<> 'admin'`; the comparison is rewritten
--    with `is distinct from`, so a caller without a role in that workspace is refused as well.
--    Everything else in their bodies is unchanged (taken verbatim from the current definitions).
-- 2. The access helpers additionally require the caller to belong to the workspace. The RLS policies
--    that use them already require it; this makes a direct call answer the same way.
-- 3. A chat session can only be created in one of the caller's own workspaces.
-- 4. A profile is readable by its owner, by members of a workspace it shares, and by Sqemes admins.
--
-- Verified by the tenant-isolation suite (tests/isolation, SQEM-504).

CREATE OR REPLACE FUNCTION public.release_restricted_content(p_workspace_id uuid, p_user_id uuid)
 RETURNS TABLE(templates integer, personas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t_count integer;
  p_count integer;
begin
  if public.get_user_role(p_workspace_id) is distinct from 'admin' then
    raise exception 'Only a workspace admin may release restricted content';
  end if;

  with removed as (
    delete from public.template_access ta
    using public.prompts p
    where ta.template_id = p.id
      and p.workspace_id  = p_workspace_id
      and p.created_by    = p_user_id
      and ta.role is null and ta.user_id is null and ta.group_id is null
    returning ta.id
  )
  select count(*)::integer into t_count from removed;

  with removed as (
    delete from public.persona_access pa
    using public.personas pe
    where pa.persona_id = pe.id
      and pe.workspace_id = p_workspace_id
      and pe.created_by   = p_user_id
      and pa.user_id is null and pa.group_id is null
    returning pa.id
  )
  select count(*)::integer into p_count from removed;

  return query select t_count, p_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handover_content_from_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.get_user_role(p_workspace_id) is distinct from 'admin' then
    raise exception 'Only a workspace admin may hand over another member''s content';
  end if;

  -- ⚠️ Der Ziel-Admin wird DRINNEN bestimmt (laengste Zugehoerigkeit), nicht hier. Wer die Uebergabe
  -- ausloest, waehlt nicht, wer sie bekommt — sonst waere „Obhut uebertragen" ein Weg, sich fremde
  -- Arbeit zuzuschreiben.
  perform public.reassign_orphaned_content(p_workspace_id, p_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.unshare_chat_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s record;
begin
  select id, workspace_id, visibility into s
  from public.chat_sessions
  where id = p_session_id;

  if s.id is null then
    raise exception 'Chat session not found';
  end if;

  -- ⛔ Admin DIESES Workspace, nicht irgendeines. Ohne die Bindung an `s.workspace_id` waere ein
  -- Admin eines beliebigen Workspace berechtigt, in einem fremden zu wirken.
  if public.get_user_role(s.workspace_id) is distinct from 'admin' then
    raise exception 'Only a workspace admin may withdraw a shared chat';
  end if;

  /*
   * ⛔ NUR IN EINE RICHTUNG, UND DAS IST DER KERN DIESER FUNKTION.
   *
   *   geteilt  -> privat   erlaubt
   *   privat   -> geteilt  NIEMALS
   *
   * Zuruecknehmen ist eine VERRINGERUNG, Teilen ist eine OFFENLEGUNG. Ein Admin, der den privaten
   * Chat einer Kollegin sichtbar machen kann, haette eine voellig andere Befugnis als einer, der eine
   * bereits getroffene Teilung zuruecknimmt — und der Unterschied verschwindet, sobald die Funktion
   * beide Richtungen kann.
   *
   * ⚠️ Deshalb nimmt sie KEINEN Zielwert entgegen. Ein Parameter `p_visibility` waere die bequemere
   * Signatur und genau der Weg, auf dem die Gegenrichtung spaeter „nur noch durchgereicht" wird.
   */
  if s.visibility <> 'workspace' then
    raise exception 'This chat is not shared; there is nothing to withdraw';
  end if;

  -- Der Trigger `manage_chat_session_expiry` setzt `expires_at` dabei auf now() + 30 Tage. Hier
  -- NICHT selbst setzen: zwei Stellen, die dieselbe Frist bestimmen, driften auseinander.
  update public.chat_sessions
  set visibility = 'private'
  where id = p_session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.count_restricted_content_for_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS TABLE(templates integer, personas integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ⛔ Security-definer-Funktion: der AUFRUFER muss Admin dieses Workspace sein. Ohne diese Zeile
  -- waere das eine Auskunft darueber, wie viele private Objekte eine beliebige Person besitzt.
  if public.get_user_role(p_workspace_id) is distinct from 'admin' then
    raise exception 'Only a workspace admin may count restricted content';
  end if;

  return query
  select
    (select count(*)::integer from public.prompts p
      where p.workspace_id = p_workspace_id
        and p.created_by = p_user_id
        and exists (select 1 from public.template_access ta where ta.template_id = p.id)),
    (select count(*)::integer from public.personas pe
      where pe.workspace_id = p_workspace_id
        and pe.created_by = p_user_id
        and exists (select 1 from public.persona_access pa where pa.persona_id = pe.id));
end;
$function$;

CREATE OR REPLACE FUNCTION public.can_access_template(p_template_id uuid, p_workspace_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p_workspace_id in (select public.get_user_workspace_ids())
    and (
    p_created_by = (select auth.uid())
    or (
      not exists (
        select 1 from public.template_access ta
        where ta.template_id = p_template_id
          and ta.role is null and ta.user_id is null and ta.group_id is null
      )
      and (
        not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
        or public.is_named_on_template(p_template_id, p_workspace_id, (select auth.uid()))
      )
    )
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_persona(p_persona_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (select 1 from public.personas pe
            where pe.id = p_persona_id and pe.workspace_id in (select public.get_user_workspace_ids()))
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

CREATE OR REPLACE FUNCTION public.can_access_file(p_file_id uuid, p_workspace_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p_workspace_id in (select public.get_user_workspace_ids())
    and (
    -- The uploader, always. Covers the file that has no template yet.
    p_created_by = (select auth.uid())
    or exists (
      select 1 from public.prompts p
      where p.workspace_id = p_workspace_id
        and p_file_id = any(p.context_file_ids)
        and public.can_access_template(p.id, p.workspace_id, p.created_by)
    )
    );
$function$;

DROP POLICY IF EXISTS chat_sessions_insert ON public.chat_sessions;
CREATE POLICY chat_sessions_insert ON public.chat_sessions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND workspace_id IN (SELECT public.get_user_workspace_ids())
  );

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR id IN (SELECT m.user_id FROM public.workspace_members m
              WHERE m.workspace_id IN (SELECT public.get_user_workspace_ids()))
    OR (SELECT public.is_sqemes_admin())
  );

-- Self-check: fail rather than ship a migration that did not take effect.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.release_restricted_content(uuid, uuid)', 'public.handover_content_from_member(uuid, uuid)',
    'public.unshare_chat_session(uuid)', 'public.count_restricted_content_for_member(uuid, uuid)'
  ] LOOP
    IF position($q$<> 'admin'$q$ IN pg_get_functiondef(fn::regprocedure)) > 0
       OR position($q$is distinct from 'admin'$q$ IN pg_get_functiondef(fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'SQEM-505: % still compares the role with <>', fn;
    END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.can_access_template(uuid, uuid, uuid)', 'public.can_access_persona(uuid, uuid)',
    'public.can_access_file(uuid, uuid, uuid)'
  ] LOOP
    IF position('get_user_workspace_ids' IN pg_get_functiondef(fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'SQEM-505: % does not check workspace membership', fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_sessions'
                 AND policyname = 'chat_sessions_insert' AND with_check LIKE '%get_user_workspace_ids%') THEN
    RAISE EXCEPTION 'SQEM-505: chat_sessions_insert does not check the workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
             AND cmd = 'SELECT' AND qual = 'true') THEN
    RAISE EXCEPTION 'SQEM-505: a profiles SELECT policy still allows everything';
  END IF;
END $$;
