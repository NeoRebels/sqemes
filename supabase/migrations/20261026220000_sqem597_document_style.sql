-- SQEM-597 — the workspace's document style for files from sqemes Chat: house colour, font, logo,
-- header, footer, page size (Settings → Brand → Document style). A file's own `style` (from a skill,
-- stored in chat_messages.generated_files) wins over this; this wins over the plain built-in layout.
--
-- Shape is checked here only roughly (an object, ≤ 4 KB); every field is validated where it is used
-- (supabase/functions/_shared/documentStyle.ts → normalizeDocumentStyle), and unknown fields are
-- dropped there, never applied.
--
-- Admins only — the same arrangement as default_edit_restricted (SQEM-534): writable through the
-- client's settings path (column grant since SQEM-109), but the workspaces UPDATE policy admits editors
-- too, so a guard keeps the old value for anyone who is not an admin, and a client insert starts empty.

alter table public.workspaces add column if not exists document_style jsonb;

alter table public.workspaces
  add constraint workspaces_document_style_shape check (
    document_style is null
    or (jsonb_typeof(document_style) = 'object' and octet_length(document_style::text) <= 4096)
  );

comment on column public.workspaces.document_style is
  'SQEM-597 — {primaryColor, font, logo, header, footer, pageSize} for files from Chat. Admins only; see guard_document_style.';

grant update (document_style) on public.workspaces to authenticated;

create or replace function public.guard_document_style()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.document_style := null;
  elsif new.document_style is distinct from old.document_style
        and public.get_user_role(old.id) is distinct from 'admin' then
    new.document_style := old.document_style;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_document_style on public.workspaces;
create trigger guard_document_style before insert or update on public.workspaces
  for each row execute function public.guard_document_style();
