-- SQEM-519 (B) — the second opinion of a language model on a marketplace submission.
--
-- Written by the submit functions after the listing is stored (`_shared/aiFileReview.ts`), on the
-- Sqemes-funded model, capped per UTC day. ⛔ Advisory only: nothing in the approval rules below reads
-- it, and it is a server-only fact like the rest of the review — an admin's client cannot write a
-- comforting opinion onto a listing before approving it.
--
-- The trigger function is the one from 20261017200000 with `ai_review` added to the server-only facts.
-- Exported to self-host like that migration: the column stays empty there.

alter table public.library_templates
  add column if not exists ai_review jsonb;

comment on column public.library_templates.ai_review is
  'SQEM-519 (B) — advisory model opinion {status, at, model, verdict, summary, findings[], omitted[], reason, usage}. Server-written; never a gate.';

-- The daily cap counts reviews by their start time.
create index if not exists library_templates_ai_review_at
  on public.library_templates ((ai_review->>'at')) where ai_review is not null;

create or replace function public.guard_listing_review()
returns trigger language plpgsql set search_path = public as $$
declare
  server boolean := current_user in ('postgres', 'service_role', 'supabase_admin');
  going_live boolean;
begin
  if not server then
    if tg_op = 'INSERT' then
      new.file_review := null; new.bundle_hash := null; new.needs_file_review := false; new.ai_review := null;
      new.files_confirmed := false; new.reviewed_by := null; new.reviewed_at := null;
    else
      if new.file_review is distinct from old.file_review
         or new.ai_review is distinct from old.ai_review
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

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'library_templates' and column_name = 'ai_review') then
    raise exception 'SQEM-519 (B) self-check: ai_review column missing';
  end if;
  if position('ai_review' in pg_get_functiondef('public.guard_listing_review'::regproc)) = 0 then
    raise exception 'SQEM-519 (B) self-check: guard_listing_review does not protect ai_review';
  end if;
  if exists (select 1 from pg_proc where proname = 'guard_listing_review' and prosecdef) then
    raise exception 'SQEM-519 (B) self-check: guard_listing_review must be SECURITY INVOKER';
  end if;
end $$;
