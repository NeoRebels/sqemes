-- ============================================================
-- Phase 8: Invitations System + Trigger Fixes
-- ============================================================

-- -------------------- INVITATIONS TABLE --------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null,
  role public.workspace_role not null default 'member',
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid references public.profiles on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique(workspace_id, email)
);

alter table public.invitations enable row level security;

create index idx_invitations_workspace on public.invitations (workspace_id);
create index idx_invitations_email on public.invitations (email);
create index idx_invitations_token on public.invitations (token);

-- ==================== RLS POLICIES FOR INVITATIONS ====================

-- Workspace members can see their workspace's invitations
create policy "invitations_select"
  on public.invitations for select
  to authenticated
  using (workspace_id in (select public.get_user_workspace_ids()));

-- Admin or editor can create invitations
create policy "invitations_insert"
  on public.invitations for insert
  to authenticated
  with check (
    public.get_user_role(workspace_id) in ('admin', 'editor')
  );

-- The invited user (by email match) or admin can update invitations
create policy "invitations_update"
  on public.invitations for update
  to authenticated
  using (
    email = (select email from auth.users where id = auth.uid())
    or public.get_user_role(workspace_id) = 'admin'
  );

-- Admin can delete invitations
create policy "invitations_delete"
  on public.invitations for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) = 'admin'
    or public.get_user_role(workspace_id) = 'editor'
  );

-- ==================== FIX handle_new_user() ====================
-- Use COALESCE to handle all OAuth providers (Google uses full_name, GitHub uses user_name, etc.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, avatar)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'user_name',
      new.raw_user_meta_data->>'preferred_username',
      split_part(new.email, '@', 1)
    ),
    new.email,
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      'https://api.dicebear.com/7.x/notionists/svg?seed=' || new.id::text
    )
  );
  return new;
end;
$$;

-- ==================== FIX handle_new_profile() ====================
-- Conditional workspace creation: if pending invitations exist, accept them instead
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  inv record;
  inv_count integer;
begin
  -- Check for pending invitations for this user's email
  select count(*) into inv_count
  from public.invitations
  where email = new.email and status = 'pending';

  if inv_count > 0 then
    -- Accept all pending invitations
    for inv in
      select id, workspace_id, role
      from public.invitations
      where email = new.email
        and status = 'pending'
        and expires_at > now()
    loop
      insert into public.workspace_members (workspace_id, user_id, role)
      values (inv.workspace_id, new.id, inv.role)
      on conflict (workspace_id, user_id) do nothing;

      update public.invitations
      set status = 'accepted'
      where id = inv.id;
    end loop;

    -- Mark expired invitations
    update public.invitations
    set status = 'expired'
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

-- ==================== accept_invitation RPC ====================
-- For existing users clicking invite links (not at signup)
create or replace function public.accept_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  caller_email text;
begin
  -- Get caller's email
  select email into caller_email
  from auth.users
  where id = auth.uid();

  if caller_email is null then
    raise exception 'Not authenticated';
  end if;

  -- Find the invitation
  select * into inv
  from public.invitations
  where token = p_token;

  if inv is null then
    raise exception 'Invitation not found';
  end if;

  if inv.status != 'pending' then
    raise exception 'Invitation has already been %', inv.status;
  end if;

  if inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = inv.id;
    raise exception 'Invitation has expired';
  end if;

  if inv.email != caller_email then
    raise exception 'This invitation was sent to a different email address';
  end if;

  -- Check if already a member
  if exists (
    select 1 from public.workspace_members
    where workspace_id = inv.workspace_id and user_id = auth.uid()
  ) then
    -- Already a member, just mark invitation as accepted
    update public.invitations set status = 'accepted' where id = inv.id;
    return inv.workspace_id;
  end if;

  -- Insert into workspace_members
  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role);

  -- Mark invitation as accepted
  update public.invitations set status = 'accepted' where id = inv.id;

  return inv.workspace_id;
end;
$$;

-- ==================== create_workspace RPC ====================
-- Atomically creates a workspace + admin membership in one call.
-- Needed because INSERT ... RETURNING requires SELECT RLS to pass,
-- but the user isn't a member until the membership row is inserted.
create or replace function public.create_workspace(ws_name text, creator_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name, plan, credits_limit)
  values (ws_name, 'Starter', 0)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, creator_id, 'admin');

  return ws_id;
end;
$$;

-- ==================== REFRESH POSTGREST SCHEMA CACHE ====================
-- Required after creating new tables/functions so PostgREST picks up changes
notify pgrst, 'reload schema';
