-- Starter plan: unlimited credits (BYOK only)
-- Set credits_limit = 0 to mean "unlimited" for all existing Starter workspaces
UPDATE public.workspaces SET credits_limit = 0 WHERE plan = 'Starter';

-- Update the default column value for new workspaces
ALTER TABLE public.workspaces ALTER COLUMN credits_limit SET DEFAULT 0;

-- Update the trigger function that creates workspaces on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
declare
  ws_id uuid;
  inv record;
begin
  -- Create profile
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));

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
    values (new.name || '''s Workspace', 'Starter', 0)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'admin');
  end if;

  return new;
end;
$$;

-- Drop the old overload that accepted creator_id (now uses auth.uid() instead)
DROP FUNCTION IF EXISTS public.create_workspace(text, uuid);

-- Update the create_workspace function (uses auth.uid() for security)
CREATE OR REPLACE FUNCTION public.create_workspace(ws_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name, plan, credits_limit)
  values (ws_name, 'Starter', 0)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, auth.uid(), 'admin');

  return ws_id;
end;
$$;
