-- SQEM-169 — Marketplace Phase 3b: votes, injection-scan fields, and a duplicate-submission guard.
-- Additive; the reports table already exists (SQEM-163).

-- 1. library_templates: vote aggregates + scan verdict + dedup keys.
alter table public.library_templates
  add column if not exists score            integer not null default 0,   -- net votes (up - down)
  add column if not exists vote_count        integer not null default 0,
  add column if not exists source_prompt_id  uuid,                          -- the workspace template it was published from
  add column if not exists content_hash      text,                          -- sha256(title+description+content)
  add column if not exists scan_risk         text check (scan_risk in ('low', 'medium', 'high')),
  add column if not exists scan_reasons      jsonb not null default '[]';

-- 2. Votes — one per user per listing.
create table if not exists public.library_template_votes (
  id                  uuid primary key default gen_random_uuid(),
  library_template_id uuid not null references public.library_templates(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  value               smallint not null check (value in (-1, 1)),
  created_at          timestamptz not null default now(),
  unique (library_template_id, user_id)
);
alter table public.library_template_votes enable row level security;
-- A user manages only their own vote; reads are limited to own rows (scores are read off the aggregate).
create policy "votes_own_all" on public.library_template_votes
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 3. Keep library_templates.score/vote_count accurate as votes change.
create or replace function public.refresh_listing_votes()
returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  lid := coalesce(new.library_template_id, old.library_template_id);
  update public.library_templates lt set
    score = coalesce((select sum(value) from public.library_template_votes where library_template_id = lid), 0),
    vote_count = coalesce((select count(*) from public.library_template_votes where library_template_id = lid), 0)
  where lt.id = lid;
  return null;
end $$;

drop trigger if exists trg_refresh_listing_votes on public.library_template_votes;
create trigger trg_refresh_listing_votes
  after insert or update or delete on public.library_template_votes
  for each row execute function public.refresh_listing_votes();

-- 4. Duplicate-submission guard — per workspace, while a listing is active (pending/published).
--    Re-submitting the same source template, or identical content, is blocked until it's rejected/unpublished.
create unique index if not exists library_templates_dedup_source
  on public.library_templates (workspace_id, source_prompt_id)
  where status in ('pending', 'published') and source_prompt_id is not null;

create unique index if not exists library_templates_dedup_hash
  on public.library_templates (workspace_id, content_hash)
  where status in ('pending', 'published') and content_hash is not null;
