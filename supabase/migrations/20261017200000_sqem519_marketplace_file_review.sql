-- SQEM-519 (A) — a marketplace listing carries the review of every one of its files, and going live
-- requires that a person looked at them.
--
-- Until now: the scan read only the listing body; the hash covered title, description and content but
-- no file; the moderator saw a file COUNT; and approving was a plain client UPDATE that recorded
-- nothing. The submit functions now review every file from its bytes (`_shared/fileReview.ts`) and
-- write the result here. This migration adds the columns and moves the approval rules into the
-- database, where a client cannot skip them:
--
--   • going live (status → 'published', or published → true) with scripts, assets or any non-text
--     file requires `files_confirmed`; a high-risk listing requires a written `review_note`;
--   • who approved or rejected, and when, is set HERE (`auth.uid()`, `now()`), never by the client;
--   • the review facts (`file_review`, `bundle_hash`, `needs_file_review`, `scan_*`, `bundle_path`) are
--     written by the server only — an admin's client cannot "clean" a flagged listing before approving.
--
-- Existing rows keep `needs_file_review = false` (they hold text, images and PDFs only — SQEM-514), so
-- nothing already published changes. Exported to self-host: there the table is unused (self-host reads
-- the Cloud marketplace), and the trigger is harmless.

alter table public.library_templates
  add column if not exists file_review jsonb,
  add column if not exists bundle_hash text,
  add column if not exists needs_file_review boolean not null default false,
  add column if not exists files_confirmed boolean not null default false,
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

comment on column public.library_templates.file_review is
  'SQEM-519 — per-file review from the bytes (path, size, sha256, kind, flags), hosts, rejected files. Server-written.';
comment on column public.library_templates.bundle_hash is
  'SQEM-519 — sha256 over every file''s path and sha256 plus the listing text. What was reviewed is what is copied.';

-- SECURITY INVOKER on purpose: `current_user` must be the caller's role (a definer always sees postgres).
create or replace function public.guard_listing_review()
returns trigger language plpgsql set search_path = public as $$
declare
  server boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  going_live boolean;
begin
  if not server then
    if tg_op = 'INSERT' then
      new.file_review := null; new.bundle_hash := null; new.needs_file_review := false;
      new.files_confirmed := false; new.reviewed_by := null; new.reviewed_at := null;
    else
      if new.file_review is distinct from old.file_review
         or new.bundle_hash is distinct from old.bundle_hash
         or new.needs_file_review is distinct from old.needs_file_review
         or new.scan_risk is distinct from old.scan_risk
         or new.scan_reasons is distinct from old.scan_reasons
         or new.bundle_path is distinct from old.bundle_path then
        raise exception 'The review of a listing is written by the server only'
          using errcode = '42501', hint = 'review_facts_server_only';
      end if;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    going_live := (new.status = 'published' and old.status is distinct from 'published')
               or (new.published and not old.published);
    if going_live then
      if new.needs_file_review and not new.files_confirmed then
        raise exception 'This listing has scripts or other files: confirm that you reviewed them before approving'
          using errcode = 'P0001', hint = 'files_unconfirmed';
      end if;
      if new.scan_risk = 'high' and coalesce(btrim(new.review_note), '') = '' then
        raise exception 'This listing is flagged high risk: give a reason for approving it'
          using errcode = 'P0001', hint = 'review_note_required';
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_listing_review on public.library_templates;
create trigger guard_listing_review
  before insert or update on public.library_templates
  for each row execute function public.guard_listing_review();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'guard_listing_review' and tgrelid = 'public.library_templates'::regclass) then
    raise exception 'SQEM-519 self-check: guard_listing_review trigger missing';
  end if;
  if exists (select 1 from pg_proc where proname = 'guard_listing_review' and prosecdef) then
    raise exception 'SQEM-519 self-check: guard_listing_review must be SECURITY INVOKER (current_user check)';
  end if;
end $$;
