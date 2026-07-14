-- SQEM-121 — Don't create a redundant personal workspace for invited users.
--
-- handle_new_user() runs at signup: it creates a profile and either accepts a pending
-- invitation (joining the inviter's workspace) OR creates a personal workspace. GoTrue's
-- signup path can invoke the trigger more than once (insert + autoconfirm); on the later
-- pass the invitation is already 'accepted', so the else-branch fired and created a personal
-- workspace ON TOP OF the invited membership. Result: invited users landed in two workspaces.
--
-- Fix: make provisioning idempotent. Accept any pending invitations, then create a personal
-- workspace ONLY when the user ends up in no workspace at all. The membership check also makes
-- a repeated trigger invocation a no-op.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
  inv record;
  display_name text;
begin
  display_name := coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1));

  insert into public.profiles (id, email, name)
  values (new.id, new.email, display_name)
  on conflict (id) do nothing;

  -- Accept every pending, non-expired invitation for this email (idempotent).
  for inv in
    select * from public.invitations
    where email = new.email and status = 'pending' and expires_at > now()
  loop
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, new.id, inv.role)
    on conflict (workspace_id, user_id) do nothing;

    update public.invitations set status = 'accepted' where id = inv.id;
  end loop;

  -- Tidy expired pending invitations for this email.
  delete from public.invitations
  where email = new.email and status = 'pending' and expires_at <= now();

  -- Create a personal workspace ONLY if the user isn't in ANY workspace (i.e. not invited).
  if not exists (select 1 from public.workspace_members where user_id = new.id) then
    insert into public.workspaces (name, plan, credits_limit)
    values (display_name || '''s Workspace', 'Solo', 0)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'admin')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return new;
end;
$$;
