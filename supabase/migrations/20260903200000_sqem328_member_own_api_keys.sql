-- ============================================================
-- SQEM-328 — a member may hold their own MCP key
-- ============================================================
--
-- A member could not reach Settings → API & MCP at all, so they could not connect their own MCP
-- client to the workspace — while being perfectly entitled to *use* the templates that connection
-- would serve. The tab is the only way to obtain a key, so "no key" was a side effect of a tab
-- filter rather than a decision anybody made.
--
-- ⚠️ **This is one role added to an existing policy, not a new security model.** SQEM-293 already
-- built the shape: `user_id = auth.uid()` in USING *and* WITH CHECK, so the holder sees only their
-- own keys and cannot mint a workspace-wide one (`user_id = null`) even by calling the API
-- directly. The UI half is in `pages/Settings.tsx` (`user_id: bindToMe || !isWorkspaceAdmin ? me :
-- null`); this is the half that holds when the UI is not involved.
--
-- ⛔ **What a member still cannot do, and why the line sits there:**
--   * **AI provider keys** stay out of reach (`workspace_api_keys`, gated in the UI by
--     `api-keys:manage`). Those are workspace-wide credentials that cost money on every call — a
--     different object from "my connection", sharing a tab by accident of layout.
--   * **A workspace-wide MCP key** stays admin-only. Such a key acts as the workspace and sees
--     everything open in it; that is a wider reach than the person's own account, and handing it
--     out is a decision, not a convenience.
--
-- The policy is renamed from `..._editor_own` to `..._own`, because it no longer describes editors.
-- A policy whose name contradicts its condition is read as a bug by the next person.

alter table public.sqemes_api_keys enable row level security;

drop policy if exists "sqemes_api_keys_editor_own" on public.sqemes_api_keys;
drop policy if exists "sqemes_api_keys_own"        on public.sqemes_api_keys;

create policy "sqemes_api_keys_own"
  on public.sqemes_api_keys for all
  to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('editor', 'member')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = sqemes_api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('editor', 'member')
    )
  );

comment on table public.sqemes_api_keys is
  'MCP API keys. RLS: admins manage every key in the workspace (sqemes_api_keys_admin_all); editors AND members (SQEM-328) manage only their own — user_id = themselves, enforced in WITH CHECK so a direct API call cannot create a workspace-wide key. A workspace-wide key (user_id null) remains admin-only: it acts as the whole workspace. AI provider keys are a different table (workspace_api_keys) and stay closed to members. Policies live in migrations since SQEM-293 — they were dashboard-only until 2026-08-31, which is how an editor came to be able to update a key but not create or see one.';
