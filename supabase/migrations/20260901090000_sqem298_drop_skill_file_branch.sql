-- ============================================================
-- SQEM-298 phase 1 — `can_access_file()` stops looking through embedded skills
-- ============================================================
--
-- SQEM-291b taught this function a second way for a file to be reachable: through a skill that a
-- template embeds via `skill_ids`. That branch was correct for the model as it stood, and it is
-- being removed because the model is going, not because it was wrong.
--
-- **Embedding skills into templates is over.** SQEM-167 took it out of the editor in July;
-- SQEM-047's migration had already emptied `skill_ids` on every database that runs the chain in
-- June. Phase 1 of SQEM-298 removes the last writer, so from here nothing can put an id back.
--
-- ⛔ **The column itself stays until phase 2, and that is not caution — it is a hard dependency.**
-- The Chrome extension names `skill_ids` in *every* template query it makes, not just a skill path.
-- Dropping the column now answers those queries with a PostgREST 400 and the extension stops
-- loading templates at all. Phase 2 waits on a Chrome Web Store release, which runs on Google's
-- clock rather than ours.
--
-- ⚠️ **This narrows what is visible.** A file reachable *only* through an embedded skill becomes
-- invisible to anyone who is not its uploader and cannot reach a template that lists it directly.
-- That set is empty — `skill_ids` is empty everywhere — but the sentence is the honest description
-- of what the statement does, and "the set is empty today" is a fact about data, not about code.

-- ⚠️ Three parameters, matching SQEM-291/291b exactly. A two-argument version would not replace
-- this function — Postgres would add an **overload**, leave the old one in place, and every caller
-- would go on using the version this migration was written to retire. `create or replace` only
-- replaces when the signature is identical.

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
        and p_file_id = any(p.context_file_ids)
        and public.can_access_template(p.id, p.workspace_id, p.created_by)
    );
$$;

comment on function public.can_access_file(uuid, uuid, uuid) is
  'SQEM-291/298 — a file is visible to whoever uploaded it, and to anyone who can reach a template that lists it in context_file_ids. The embedded-skill branch (SQEM-291b) was removed in SQEM-298 phase 1 together with the feature it served.';

-- The index existed only for the branch above: `skill_ids` was scanned per row the way
-- `context_file_ids` still is. With no query left that reads it, it is write cost on every template
-- insert and update, paid for nothing.
drop index if exists public.prompts_skill_ids_gin;
