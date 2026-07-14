-- Allow users to delete their own history items; admins can delete any within their workspace
create policy "history_delete"
  on public.history_items for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = history_items.workspace_id
        and workspace_members.user_id = auth.uid()
        and workspace_members.role = 'admin'
    )
  );
