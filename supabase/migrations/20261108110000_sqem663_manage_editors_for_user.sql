-- SQEM-663 — who may SET the editor list of a playbook or persona, asked for a given person.
--
-- MCP and Chat write with the service key, so `auth.uid()` is empty there and the client form
-- (`can_manage_template_editors` / `can_manage_persona_editors`, SQEM-473) cannot answer for the
-- person behind the connection. `set_editors` needs the same rule for an explicit user id — the
-- pattern `template_edit_allowed(id, user)` already set for editing.
--
-- ⛔ ONE rule, not two: the client forms now call these with `auth.uid()`, so the app and the MCP
-- cannot drift apart. The rule itself is unchanged: an admin, or the owner while an editor — and only
-- for something they can see. Not any editor: otherwise the next editor simply removes the
-- restriction.
--
-- ⛔ Service only. A client calling the user-id form could ask about anybody (SQEM-503).

create or replace function public.template_editors_manage_allowed(p_template_id uuid, p_user_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.prompts p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = p_user_id
     where p.id = p_template_id
       and p.id in (select id from public.mcp_accessible_template_ids(p.workspace_id, p_user_id))
       and (wm.role = 'admin' or (wm.role = 'editor' and p.created_by = p_user_id))
  );
$function$;

create or replace function public.persona_editors_manage_allowed(p_persona_id uuid, p_user_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.personas pe
      join public.workspace_members wm on wm.workspace_id = pe.workspace_id and wm.user_id = p_user_id
     where pe.id = p_persona_id
       and pe.id in (select id from public.mcp_accessible_persona_ids(pe.workspace_id, p_user_id))
       and (wm.role = 'admin' or (wm.role = 'editor' and pe.created_by = p_user_id))
  );
$function$;

-- The client forms: the same rule for auth.uid(). `create or replace` keeps their existing grants.
create or replace function public.can_manage_template_editors(p_template_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.template_editors_manage_allowed(p_template_id, (select auth.uid())) $function$;

create or replace function public.can_manage_persona_editors(p_persona_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$ select public.persona_editors_manage_allowed(p_persona_id, (select auth.uid())) $function$;

revoke all on function public.template_editors_manage_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function public.persona_editors_manage_allowed(uuid, uuid)  from public, anon, authenticated;
grant execute on function public.template_editors_manage_allowed(uuid, uuid), public.persona_editors_manage_allowed(uuid, uuid) to service_role;
