-- ============================================================
-- Phase 2: Database Schema for PromptMaster (sqemes)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- -------------------- ENUMS --------------------
create type public.plan_tier as enum ('Starter', 'Pro', 'Plus');
create type public.workspace_role as enum ('admin', 'editor', 'member');
create type public.folder_type as enum ('global', 'personal');
create type public.run_status as enum ('success', 'error');

-- -------------------- PROFILES --------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text not null default '',
  avatar text not null default '',
  created_at timestamptz not null default now()
);

-- -------------------- WORKSPACES --------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan public.plan_tier not null default 'Starter',
  credits_used integer not null default 0,
  credits_limit integer not null default 0,
  blacklisted_terms text[] not null default '{}',
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- -------------------- WORKSPACE MEMBERS (junction) --------------------
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role public.workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- -------------------- WORKSPACE API KEYS --------------------
create table public.workspace_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  provider text not null,
  encrypted_key text not null,
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

-- -------------------- FOLDERS --------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  type public.folder_type not null default 'global',
  user_id uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- -------------------- ASSISTANTS --------------------
create table public.assistants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  description text not null default '',
  system_prompt text not null default '',
  avatar text not null default '',
  created_at timestamptz not null default now()
);

-- -------------------- PROMPTS --------------------
create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  variables jsonb not null default '[]',
  steps jsonb not null default '[]',
  created_by uuid references public.profiles on delete set null,
  usage_count integer not null default 0,
  folder_id uuid references public.folders on delete set null,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------- HISTORY ITEMS --------------------
create table public.history_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  prompt_id uuid references public.prompts on delete set null,
  prompt_title text not null default '',
  user_id uuid references public.profiles on delete set null,
  user_name text not null default '',
  inputs jsonb not null default '{}',
  results jsonb not null default '[]',
  status public.run_status not null default 'success',
  created_at timestamptz not null default now()
);

-- -------------------- SAVED RESULTS --------------------
create table public.saved_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  title text not null,
  prompt_id uuid references public.prompts on delete set null,
  prompt_title text not null default '',
  folder_id uuid references public.folders on delete set null,
  results jsonb not null default '[]',
  step_titles jsonb not null default '[]',
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Returns workspace IDs the current user belongs to
create or replace function public.get_user_workspace_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select workspace_id
  from public.workspace_members
  where user_id = auth.uid();
$$;

-- Returns the role of the current user in a specific workspace
create or replace function public.get_user_role(ws_id uuid)
returns public.workspace_role
language sql
security definer
stable
as $$
  select role
  from public.workspace_members
  where workspace_id = ws_id and user_id = auth.uid();
$$;

-- Atomically increment credits_used
create or replace function public.increment_credits(ws_id uuid, amount integer)
returns void
language sql
security definer
as $$
  update public.workspaces
  set credits_used = credits_used + amount
  where id = ws_id;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile on auth.users insert
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
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      'https://api.dicebear.com/7.x/notionists/svg?seed=' || new.id::text
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-create default workspace + admin membership on profile insert
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.workspaces (name, plan, credits_limit)
  values (new.name || '''s Workspace', 'Starter', 0)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'admin');

  return new;
end;
$$;

create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_workspace_members_user on public.workspace_members (user_id);
create index idx_prompts_workspace on public.prompts (workspace_id);
create index idx_history_workspace on public.history_items (workspace_id);
create index idx_folders_workspace on public.folders (workspace_id);
create index idx_assistants_workspace on public.assistants (workspace_id);
create index idx_saved_results_workspace on public.saved_results (workspace_id);
create index idx_api_keys_workspace on public.workspace_api_keys (workspace_id);
