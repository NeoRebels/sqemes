-- SQEM-207 — new workspaces are named after the person, not "<name>'s Workspace".
--
-- The generated name repeated its own label and was too long for the place it is shown. In the
-- sidebar it sits in a box of max-width 120px at 500 12px Inter — 19 characters fit, so
-- "Francisco Otto's Workspace" rendered as "Francisco Otto's Wo", directly under the word "sqemes"
-- and next to a menu called "Switch Workspace". Both findings from the 2026-08-05 usability test
-- (truncated name, doubled "Workspace") were this one cause.
--
-- Widening the box alone would not have fixed it: the reader would then see
-- "Francisco Otto's Workspace" beside a button labelled "Switch Workspace". The word belongs to the
-- surrounding UI, not to the name.
--
-- Nobody on the team ever saw it because short workspace names do not truncate.
--
-- Only the naming line changes; the rest of the function is carried over verbatim from
-- 20260712000000_fix_invited_user_workspace.sql (idempotent provisioning — see its comment).
-- Existing workspaces are deliberately NOT renamed: they are user data, and a rename would surprise
-- people who have since made the name their own.

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
    values (display_name, 'Solo', 0)          -- SQEM-207: was display_name || '''s Workspace'
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'admin')
    on conflict (workspace_id, user_id) do nothing;
  end if;

  return new;
end;
$$;
