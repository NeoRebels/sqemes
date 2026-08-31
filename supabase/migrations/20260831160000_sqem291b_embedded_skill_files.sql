-- ============================================================
-- SQEM-291b — a file reached through an embedded skill is still reachable
-- ============================================================
--
-- `can_access_file()` shipped hours ago asking one question: *does an accessible template list this
-- file in `context_file_ids`?* That misses how skills actually work.
--
--   A skill is embedded in a template through `skill_ids`. Access to the skill is granted **by the
--   template that embeds it** — deliberately, and in two places that both say so:
--
--     resolve-template-skills/index.ts  "a skill restricted away from this user is still returned,
--                                        because access is granted through the parent that embeds it"
--     mcp-server/index.ts:637           resolves skill.context_file_ids with the admin client
--
-- The skill's *files* were left out of that reasoning. So:
--
--   Skill "Brand rules"   — restricted to Marketing, context file brand.md
--   Template "Quote mail" — open to everyone, embeds that skill
--   A person outside Marketing opens the template:
--     · the skill text arrives (correct — the parent grants it)
--     · brand.md does not (wrong — same grant, same reason)
--
-- ⚠️ **And the channels disagreed about it**, which is the part that makes this urgent rather than
-- untidy. MCP composes with the service role, so the file was still inlined there. The browser
-- filters `workspaceFiles` through RLS, so it silently dropped the block. **Same template, same
-- person, different prompt** — and nothing in either surface said a file had been left out.
--
-- The fix is to ask the question the way the product actually answers it: a file is reachable if an
-- accessible template lists it **or embeds a skill that lists it**.

create or replace function public.can_access_file(
  p_file_id uuid, p_workspace_id uuid, p_created_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    -- The uploader, always. Covers the file that has no template yet.
    p_created_by = (select auth.uid())
    or exists (
      select 1 from public.prompts p
      where p.workspace_id = p_workspace_id
        and public.can_access_template(p.id, p.workspace_id, p.created_by)
        and (
          p_file_id = any(p.context_file_ids)
          -- SQEM-291b — or through a skill this template embeds. The skill itself may be restricted
          -- away from the caller; that is the established rule, not an exception to it.
          or exists (
            select 1 from public.prompts s
            where s.id = any(p.skill_ids)
              and s.workspace_id = p_workspace_id
              and p_file_id = any(s.context_file_ids)
          )
        )
    );
$$;

comment on function public.can_access_file(uuid, uuid, uuid) is
  'SQEM-291/291b — a file is visible to whoever uploaded it, and to anyone who can reach a template that lists it OR embeds a skill that lists it. The second clause matters because an embedded skill is granted by its parent: without it, MCP inlined a file the browser had already filtered away, for the same person on the same template.';

-- `skill_ids` is scanned the same way `context_file_ids` is, and for the same reason needs an index.
create index if not exists prompts_skill_ids_gin
  on public.prompts using gin (skill_ids);
