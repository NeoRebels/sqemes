-- ============================================================
-- SQEM-293 — the API-key policies, written down and made consistent
-- ============================================================
--
-- Reported by an editor who could not create an API key:
--   `new row violates row-level security policy for table "sqemes_api_keys"`
--
-- ⚠️ **The policies for this table were never in a migration.** They were created in the dashboard,
-- and `20260625000001_mcp_key_update_policy.sql` said so out loud — *"already has RLS enabled with
-- select/insert/delete policies (created out-of-band)"* — then left it there. That comment was also
-- wrong: there were never three policies, only one `ALL` policy. Nobody could read the rule without
-- opening the dashboard, and a fresh environment had none of it.
--
-- What was actually there, read from `pg_policies` on 2026-08-31:
--
--   workspace_admins_manage_sqemes_api_keys · ALL    · public        · role = 'admin'
--   sqemes_api_keys_update                  · UPDATE · authenticated · role IN ('admin','editor')
--
-- Postgres ORs permissive policies together, so the effective rule was:
--
--   SELECT / INSERT / DELETE → admin only
--   UPDATE                   → admin or editor
--
-- **An editor could edit a key but not create one — and could not see one either.** That is not a
-- decision anybody made; it is two rules written at different times in different places.
--
-- ⚠️ **The silent half is the worse half.** A denied INSERT raises an error, which is how this got
-- reported. A denied SELECT returns *no rows* — so `Settings.tsx` showed editors an empty key list
-- with no error at all, and the Dashboard's MCP row read "Set up →" even where keys existed. The
-- visible bug was reported within days; the invisible one had been there since the table existed.
--
-- ============================================================
-- The rule now, and why it is not simply "admin + editor"
-- ============================================================
--
-- `lib/permissions.ts` grants `api-keys:manage` to `role !== 'member'`, so the UI has always offered
-- editors the full card. The obvious fix is to widen every policy to `('admin','editor')` and be
-- done. **That would go one step too far.**
--
-- A key with `user_id = null` is workspace-wide: `mcp-server` does not filter templates to any one
-- person, so it can read everything in the workspace. Only admins can create one — `Settings.tsx`
-- forces `user_id = currentUser.id` for everyone else (SQEM-143). Letting an editor *see* or
-- *delete* such a key would hand them either the reach it carries or the ability to revoke an
-- admin's access.
--
-- So: **admins manage every key in the workspace; editors manage their own.** That mirrors what the
-- application already enforces, and puts it where it cannot be bypassed by calling the API directly.

alter table public.sqemes_api_keys enable row level security;

-- Replace both existing policies. The dashboard ones are dropped by name; they were the only two.
drop policy if exists "workspace_admins_manage_sqemes_api_keys" on public.sqemes_api_keys;
drop policy if exists "sqemes_api_keys_update"                  on public.sqemes_api_keys;

-- ── Admins: every key in their workspace ─────────────────────────────────────
-- `to authenticated`, not `to public`. The old policy used `public`, which includes `anon`; harmless
-- while the condition tests `auth.uid()`, but it differed from every other policy in this repo for
-- no reason, and an unexplained difference costs the next reader time.
create policy "sqemes_api_keys_admin_all"
  on public.sqemes_api_keys for all
  to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );

-- ── Editors: their own keys, and only those ──────────────────────────────────
-- `user_id = auth.uid()` appears in both USING and WITH CHECK on purpose:
--   * USING     — which rows they may read, update or delete
--   * WITH CHECK — what a new or updated row may look like
-- Without the second, an editor could create a workspace-wide key (`user_id = null`) by calling the
-- API directly, or move an existing key off themselves. The UI already prevents both; this is the
-- half that holds when the UI is not involved.
create policy "sqemes_api_keys_editor_own"
  on public.sqemes_api_keys for all
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'editor'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'editor'
    )
  );

comment on table public.sqemes_api_keys is
  'MCP API keys. RLS (SQEM-293): admins manage every key in the workspace, editors manage only their own (user_id = themselves, enforced in WITH CHECK so a direct API call cannot create a workspace-wide key). Members have no access. Policies live in this migration — they were dashboard-only until 2026-08-31, which is how an editor came to be able to update a key but not create or see one.';
