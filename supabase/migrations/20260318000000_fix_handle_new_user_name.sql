-- Fix handle_new_user: new.name does not exist on auth.users.
-- Use raw_user_meta_data ->> 'name' (with email fallback) instead.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
declare
  ws_id uuid;
  inv record;
  display_name text;
begin
  display_name := coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1));

  -- Create profile
  insert into public.profiles (id, email, name)
  values (new.id, new.email, display_name);

  -- Check for pending invitations
  select * into inv
  from public.invitations
  where email = new.email
    and status = 'pending'
    and expires_at > now()
  limit 1;

  if inv.id is not null then
    -- Accept invitation
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, new.id, inv.role);

    update public.invitations
    set status = 'accepted'
    where id = inv.id;

    -- Clean up other expired invitations
    delete from public.invitations
    where email = new.email
      and status = 'pending'
      and expires_at <= now();
  else
    -- No invitations: create default workspace + admin membership
    insert into public.workspaces (name, plan, credits_limit)
    values (display_name || '''s Workspace', 'Solo', 0)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'admin');
  end if;

  return new;
end;
$$;
