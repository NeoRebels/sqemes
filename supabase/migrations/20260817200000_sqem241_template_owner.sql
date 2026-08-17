-- ============================================================
-- SQEM-241 — every template gets an owner
-- ============================================================
--
-- SQEM-240 stopped "Only me" from being picked on a template with no `created_by`, because
-- `can_access_template` matches the creator by id and `NULL = <uid>` is NULL — the choice would have
-- hidden the template from everyone, its owner included. That removed the danger and, with it, a
-- feature people need. The answer is to establish the owner, not to loosen the guard.
--
-- **The rule is not new.** `reassign_private_templates()` has handed private templates to the
-- **longest-standing admin still in the workspace** since SQEM-212, ordered by
-- `workspace_members.joined_at`, because `workspaces` has no owner column — no `created_by`, no
-- `owner_id`. This backfill applies exactly that rule to the rows that never had an owner at all.
--
-- ⚠️ **This assigns custody, not authorship.** It records who the template now belongs to for the
-- purposes of access control. It does not claim that person wrote it, and nothing downstream should
-- read it that way. Rejected on those grounds: naming one specific person across all workspaces —
-- an owner who is not even a member of the workspace is a wrong answer, not a missing one.
--
-- Measured on production 2026-08-17 before writing this: 47 rows across two workspaces (NeoRebels
-- 27, Arktis BioPharma 20), both with an admin to receive them, and in both the longest-standing
-- admin is the same person the product owner asked for — so the general rule already produces the
-- intended outcome and no workspace needs a special case.
--
-- Where the rows came from: `create_template` over MCP never set `created_by` until SQEM-240, and
-- `prompts.created_by` is `on delete set null`, so a deleted account leaves the same state behind.
--
-- ⚠️ **A workspace with no admin is left alone.** Handing a template to an arbitrary member would be
-- a worse answer than none — the same reasoning `reassign_private_templates()` uses when it finds no
-- admin. Those rows keep `created_by is null` and keep the SQEM-240 guard; there is no such
-- workspace on production today, but the statement must survive one.
--
-- Idempotent: it only touches rows that are still NULL, so a re-run is a no-op.

update public.prompts p
set created_by = (
  select m.user_id
  from public.workspace_members m
  where m.workspace_id = p.workspace_id
    and m.role = 'admin'
  order by m.joined_at asc
  limit 1
)
where p.created_by is null
  and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p.workspace_id
      and m.role = 'admin'
  );
