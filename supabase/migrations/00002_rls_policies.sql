-- ============================================================
-- Phase 3: Row-Level Security Policies
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_api_keys enable row level security;
alter table public.folders enable row level security;
alter table public.assistants enable row level security;
alter table public.prompts enable row level security;
alter table public.history_items enable row level security;
alter table public.saved_results enable row level security;

-- ==================== PROFILES ====================
-- Anyone authenticated can read profiles (needed for member lists)
create policy "profiles_select"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update only their own profile
create policy "profiles_update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ==================== WORKSPACES ====================
-- Members can view their workspaces
create policy "workspaces_select"
  on public.workspaces for select
  to authenticated
  using (id in (select public.get_user_workspace_ids()));

-- Any authenticated user can create a workspace
create policy "workspaces_insert"
  on public.workspaces for insert
  to authenticated
  with check (true);

-- Admin or editor can update workspace
create policy "workspaces_update"
  on public.workspaces for update
  to authenticated
  using (
    public.get_user_role(id) in ('admin', 'editor')
  );

-- Only admin can delete workspace
create policy "workspaces_delete"
  on public.workspaces for delete
  to authenticated
  using (
    public.get_user_role(id) = 'admin'
  );

-- ==================== WORKSPACE MEMBERS ====================
-- Members can see other members in their workspaces
create policy "workspace_members_select"
  on public.workspace_members for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Self-insert (joining) or admin can add members
create policy "workspace_members_insert"
  on public.workspace_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.get_user_role(workspace_id) = 'admin'
  );

-- Admin can update roles (but not their own)
create policy "workspace_members_update"
  on public.workspace_members for update
  to authenticated
  using (
    public.get_user_role(workspace_id) = 'admin'
    and user_id != auth.uid()
  );

-- Admin can remove members, or user can leave themselves
create policy "workspace_members_delete"
  on public.workspace_members for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) = 'admin'
    or user_id = auth.uid()
  );

-- ==================== WORKSPACE API KEYS ====================
-- BLOCKED: Only Edge Functions with service_role can access
create policy "api_keys_blocked"
  on public.workspace_api_keys for all
  to authenticated
  using (false)
  with check (false);

-- ==================== FOLDERS ====================
-- Members can view folders in their workspaces
create policy "folders_select"
  on public.folders for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Members can create folders
create policy "folders_insert"
  on public.folders for insert
  to authenticated
  with check (workspace_id in (select public.get_user_workspace_ids()));

-- Members can update folders
create policy "folders_update"
  on public.folders for update
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Admin or editor can delete folders
create policy "folders_delete"
  on public.folders for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- ==================== ASSISTANTS ====================
-- Members can view assistants
create policy "assistants_select"
  on public.assistants for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Admin or editor can create
create policy "assistants_insert"
  on public.assistants for insert
  to authenticated
  with check (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- Admin or editor can update
create policy "assistants_update"
  on public.assistants for update
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- Admin or editor can delete
create policy "assistants_delete"
  on public.assistants for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- ==================== PROMPTS ====================
-- Members can view prompts
create policy "prompts_select"
  on public.prompts for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Admin or editor can create
create policy "prompts_insert"
  on public.prompts for insert
  to authenticated
  with check (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- Admin or editor can update
create policy "prompts_update"
  on public.prompts for update
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- Admin or editor can delete
create policy "prompts_delete"
  on public.prompts for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- ==================== HISTORY ITEMS ====================
-- Members can view workspace history
create policy "history_select"
  on public.history_items for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Members can insert their own history
create policy "history_insert"
  on public.history_items for insert
  to authenticated
  with check (
    workspace_id in (select public.get_user_workspace_ids())
    and user_id = auth.uid()
  );

-- Users can update only their own history items
create policy "history_update"
  on public.history_items for update
  to authenticated
  using (user_id = auth.uid());

-- ==================== SAVED RESULTS ====================
-- Members can view saved results
create policy "saved_results_select"
  on public.saved_results for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Members can save their own results
create policy "saved_results_insert"
  on public.saved_results for insert
  to authenticated
  with check (
    workspace_id in (select public.get_user_workspace_ids())
    and created_by = auth.uid()
  );

-- Owner or admin/editor can update saved results (e.g. rename)
create policy "saved_results_update"
  on public.saved_results for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- Owner or admin can delete saved results
create policy "saved_results_delete"
  on public.saved_results for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.get_user_role(workspace_id) = 'admin'
  );
