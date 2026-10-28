-- SQEM-600 — the UI language (epic SQEM-407): a workspace default, set by admins, and a personal
-- override in the profile. The language in effect is profile → workspace → English
-- (lib/i18n.ts → effectiveLocale).
--
-- ⚠️ Until every text is translated, German is applied only for sqemes admins, whatever these columns
-- say (`GERMAN_RELEASED` in lib/i18n.ts). The columns exist now so that the switch is one constant,
-- not a migration, on the day German ships.

-- 1. Workspace default — admins only -----------------------------------------------------------------
alter table public.workspaces add column if not exists language text not null default 'en';
alter table public.workspaces
  add constraint workspaces_language_supported check (language in ('en', 'de'));
comment on column public.workspaces.language is
  'SQEM-600 — the workspace''s default UI language (en, de). Admins only; see guard_workspace_language.';

-- Writable through the client's settings path (column grants since SQEM-109)…
grant update (language) on public.workspaces to authenticated;

-- …but by an admin only. The workspaces UPDATE policy admits editors too (they reach General), so the
-- column is guarded the same way as default_edit_restricted (SQEM-534) and document_style (SQEM-597):
-- anyone else's write keeps the old value, and a client insert starts with English.
create or replace function public.guard_workspace_language()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.language := 'en';
  elsif new.language is distinct from old.language
        and public.get_user_role(old.id) is distinct from 'admin' then
    new.language := old.language;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_workspace_language on public.workspaces;
create trigger guard_workspace_language before insert or update on public.workspaces
  for each row execute function public.guard_workspace_language();

-- 2. Personal override — null follows the workspace ---------------------------------------------------
alter table public.profiles add column if not exists language text;
alter table public.profiles
  add constraint profiles_language_supported check (language is null or language in ('en', 'de'));
comment on column public.profiles.language is
  'SQEM-600 — the person''s UI language (en, de); null = the workspace default.';

-- The profiles UPDATE policy limits a person to their own row; the column grant (SQEM-489 keeps
-- profiles on an explicit list) is what makes this one writable at all.
grant update (language) on public.profiles to authenticated;
