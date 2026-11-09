-- SQEM-669 — Moderation, one list: everything waiting for review in a workspace, for its moderators.
--
-- Two functions, both DEFINER and both only for a moderator or admin of that workspace (asked of
-- is_workspace_moderator for auth.uid()):
--   review_queue(ws, limit, offset) — new playbooks and personas submitted for review (SQEM-666) and pending
--     changes to shared ones (SQEM-667), newest first, with whether the caller can open the object.
--   pending_change_released_state(change) — the released state a change is compared with.
--
-- ⛔ The gap this closes: a moderator — an admin too — sees a restricted playbook only when named on it. A
-- change to a playbook shared with three colleagues was therefore invisible to the person meant to review
-- it. The second function hands a moderator the released state of exactly the object of a WAITING change,
-- read-only, for the comparison; nothing else becomes visible, and the normal access applies again once
-- the change is decided.

create or replace function public.review_queue(p_workspace_id uuid, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_workspace_moderator(p_workspace_id, v_uid) then
    raise exception 'Only a moderator or an admin of this workspace can see the review list.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(q order by q->>'submitted_at' desc)
    from (
      select x.q from (
        select jsonb_build_object(
          'type', 'new', 'kind', 'template', 'id', p.id, 'subkind', p.kind, 'title', p.title, 'author', p.created_by,
          'submitted_at', coalesce(p.review_submitted_at, p.updated_at), 'change_id', null, 'payload', null,
          'can_open', public.can_access_template(p.id, p.workspace_id, p.created_by)) as q
          from public.prompts p where p.workspace_id = p_workspace_id and p.review_state = 'pending'
        union all
        select jsonb_build_object(
          'type', 'new', 'kind', 'persona', 'id', pe.id, 'subkind', 'persona', 'title', pe.title, 'author', pe.created_by,
          'submitted_at', coalesce(pe.review_submitted_at, pe.updated_at), 'change_id', null, 'payload', null,
          'can_open', public.can_access_persona(pe.id, pe.created_by))
          from public.personas pe where pe.workspace_id = p_workspace_id and pe.review_state = 'pending'
        union all
        select jsonb_build_object(
          'type', 'change', 'kind', c.kind, 'id', c.object_id,
          'subkind', case c.kind when 'template' then p.kind else 'persona' end,
          'title', coalesce(p.title, pe.title), 'author', c.author, 'submitted_at', c.updated_at,
          'change_id', c.id, 'payload', c.payload, 'base_updated_at', c.base_updated_at,
          'can_open', case c.kind when 'template' then public.can_access_template(p.id, p.workspace_id, p.created_by)
                                  else public.can_access_persona(pe.id, pe.created_by) end)
          from public.pending_changes c
          left join public.prompts p on c.kind = 'template' and p.id = c.object_id
          left join public.personas pe on c.kind = 'persona' and pe.id = c.object_id
          where c.workspace_id = p_workspace_id and c.state = 'pending'
      ) x
      order by x.q->>'submitted_at' desc
      limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
    ) page(q)
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.review_queue(uuid, integer, integer) from public, anon;
grant execute on function public.review_queue(uuid, integer, integer) to authenticated;

create or replace function public.pending_change_released_state(p_change_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.pending_changes;
  v jsonb;
begin
  select * into c from public.pending_changes where id = p_change_id and state = 'pending';
  if c.id is null or not public.is_workspace_moderator(c.workspace_id, (select auth.uid())) then
    raise exception 'Only a moderator or an admin of this workspace can compare this change.' using errcode = '42501';
  end if;
  if c.kind = 'template' then
    select jsonb_build_object(
      'title', p.title, 'description', p.description, 'content', p.content, 'tag', p.tag, 'kind', p.kind,
      'model', p.model, 'variables', p.variables, 'context_file_ids', to_jsonb(coalesce(p.context_file_ids, '{}'::uuid[])),
      'updated_at', p.updated_at,
      'access', coalesce((select jsonb_agg(case when ta.user_id is not null then jsonb_build_object('user_id', ta.user_id)
                                                when ta.group_id is not null then jsonb_build_object('group_id', ta.group_id)
                                                else '{}'::jsonb end)
                            from public.template_access ta where ta.template_id = p.id), '[]'::jsonb))
      into v from public.prompts p where p.id = c.object_id and p.workspace_id = c.workspace_id;
  else
    select jsonb_build_object(
      'title', pe.title, 'description', pe.description, 'content', pe.content, 'tags', to_jsonb(pe.tags),
      'connectors', pe.connectors, 'updated_at', pe.updated_at,
      'routes', coalesce((select jsonb_agg(jsonb_build_object('template_id', pt.template_id, 'condition', pt.condition) order by pt.sort_order)
                            from public.persona_templates pt where pt.persona_id = pe.id), '[]'::jsonb),
      'access', coalesce((select jsonb_agg(case when pa.user_id is not null then jsonb_build_object('user_id', pa.user_id)
                                                when pa.group_id is not null then jsonb_build_object('group_id', pa.group_id)
                                                else '{}'::jsonb end)
                            from public.persona_access pa where pa.persona_id = pe.id), '[]'::jsonb))
      into v from public.personas pe where pe.id = c.object_id and pe.workspace_id = c.workspace_id;
  end if;
  return v;
end;
$$;
revoke all on function public.pending_change_released_state(uuid) from public, anon;
grant execute on function public.pending_change_released_state(uuid) to authenticated;
