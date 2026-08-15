-- SQEM-210 — template access: editors granted for real, "only me" expressible, draft axis retired.
--
-- Three changes that belong in one migration because each is wrong without the others.
--
-- 1. EDITORS ARE GRANTED ACCESS. The UI has always claimed editors could see everything; the
--    function did not. `can_access_template` granted the creator, admins, everyone when no rule
--    existed, and whoever a rule named — an editor without a matching rule lost SELECT on a
--    restricted template. Meanwhile `prompts_update`/`prompts_delete` (00002_rls_policies.sql) are
--    admin/editor with NO access check, so an editor could already change a template they were not
--    allowed to read. The boundary was never real; this makes the promise true instead of drawing
--    it. The widening is read-only.
--
--    ⚠️ `mcp_accessible_template_ids` mirrors this logic for the mcp-server (auth.uid() is null
--    there, so the function cannot be reused). Both are changed here. Changing only one leaves the
--    app and MCP quietly disagreeing about who may see what, and each keeps working on its own.
--
-- 2. "ONLY ME" NEEDS A ROW THAT GRANTS NOBODY. With no rows a template is open to everyone, so
--    "only me" cannot be the absence of rules — it is the exact opposite. The CHECK demanded
--    *exactly* one principal per row; relaxed to *at most* one, a row with neither role nor user_id
--    says precisely what is meant: a restriction exists, and nobody is named by it. Access then
--    falls back to the creator, admins and (as of this migration) editors, through their own
--    branches. `can_access_template` needs no change for it.
--
--    Rejected: a sentinel `role = 'admin'` row. Migration-free and equally safe today, but the
--    database would then record "admins may" while meaning "nobody else may" — and if the admin
--    branch were ever dropped, the placeholder would silently become a real grant.
--    Rejected: an `access_mode` column — a second truth beside `template_access` that can drift.
--
-- 3. THE DRAFT AXIS RETIRES, AND ITS EXISTING DATA MUST NOT SILENTLY OPEN UP. `prompts.published`
--    was a second, competing answer to "who may see this" ("Draft — only editors & admins see it").
--    The editor no longer offers it, so an old draft could never be flipped back. Simply setting
--    every draft to published would publish half-written templates to all members. Instead each
--    draft *without* rules gets the new no-grantee row first — which after change 1 means exactly
--    creator + admins + editors, i.e. what "Draft" already meant. Drafts that already carry rules
--    keep them. Only then is the flag levelled.
--
--    `prompts.published` itself stays: `library_templates.published` (the marketplace listing) is a
--    different column on a different table and is untouched, and dropping the prompts column would
--    break the API contract the extension reads.

-- 1. Editors are granted access — in both places, in lockstep.
create or replace function public.can_access_template(
  p_template_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = (select auth.uid())
    or public.get_user_role(p_workspace_id) in ('admin', 'editor')
    or not exists (select 1 from public.template_access ta where ta.template_id = p_template_id)
    or exists (
      select 1 from public.template_access ta
      where ta.template_id = p_template_id
        and (ta.role = public.get_user_role(p_workspace_id) or ta.user_id = (select auth.uid()))
    );
$$;

create or replace function public.mcp_accessible_template_ids(p_workspace_id uuid, p_user_id uuid)
returns table (id uuid)
language sql stable security definer set search_path = public as $$
  with r as (
    select wm.role
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
    limit 1
  )
  select p.id
  from public.prompts p
  where p.workspace_id = p_workspace_id
    and (
      (select role from r) in ('admin', 'editor')
      or p.created_by = p_user_id
      or not exists (select 1 from public.template_access ta where ta.template_id = p.id)
      or exists (
        select 1 from public.template_access ta
        where ta.template_id = p.id
          and (ta.role = (select role from r) or ta.user_id = p_user_id)
      )
    );
$$;

-- 2. A row may now name no principal at all — that is "only me".
alter table public.template_access drop constraint if exists template_access_one_principal;
alter table public.template_access add constraint template_access_one_principal
  check ((role is not null)::int + (user_id is not null)::int <= 1);

-- The existing unique indexes are partial on the set column, so neither covers this row shape.
create unique index if not exists template_access_private_uq
  on public.template_access (template_id) where role is null and user_id is null;

-- 3. Carry the drafts over BEFORE levelling the flag — order matters, see the header.
insert into public.template_access (template_id, workspace_id)
select p.id, p.workspace_id
from public.prompts p
where p.published = false
  and not exists (select 1 from public.template_access ta where ta.template_id = p.id);

update public.prompts set published = true where published = false;
