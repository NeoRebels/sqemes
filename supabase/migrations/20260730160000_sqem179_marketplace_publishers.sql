-- SQEM-179 (SQEM-176 Phase B) — marketplace publishers for self-host submissions.
--
-- A "publisher" is a standalone, invite-only identity (NOT a Cloud account): a Sqemes admin creates it
-- and issues a token (SHA-256 hashed at rest, shown once). Self-host instances put the token in a
-- SERVER secret and submit templates to the Cloud review queue via the `marketplace-submit` edge
-- function (SQEM-180), which resolves the token with the service role. All submissions land `pending`
-- and are approved by a Sqemes admin before going live — the manual review gate is the primary safety net.

-- 1. Publishers
create table if not exists public.marketplace_publishers (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  token_hash   text not null unique,          -- SHA-256 hex of the raw token; the raw token is shown once
  banned       boolean not null default false,
  granted_by   uuid references auth.users(id) on delete set null,  -- the admin who created it
  created_at   timestamptz not null default now()
);

alter table public.marketplace_publishers enable row level security;

-- Management is Sqemes-admin only. The submit edge function uses the service role (bypasses RLS) to
-- resolve a token; no non-admin ever reads token_hash.
drop policy if exists "marketplace_publishers_admin_all" on public.marketplace_publishers;
create policy "marketplace_publishers_admin_all" on public.marketplace_publishers
  for all using (public.is_sqemes_admin()) with check (public.is_sqemes_admin());

-- 2. Attribution on listings — where a submission came from and which publisher owns it.
alter table public.library_templates
  add column if not exists publisher_id uuid references public.marketplace_publishers(id) on delete set null,
  add column if not exists source       text not null default 'cloud';  -- 'cloud' | 'self-host'

create index if not exists idx_library_templates_publisher_id on public.library_templates (publisher_id);
