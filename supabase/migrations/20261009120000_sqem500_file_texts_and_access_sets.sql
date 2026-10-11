-- SQEM-500 — fewer database round trips per library read, and no storage download in the hot path.
--
-- Measured on staging (Micro, 1000 members, 100 concurrent requests): every MCP call made 8–10
-- PostgREST round trips one after another, and under load each one waited ~7× longer — not because
-- Postgres was busy (≈11 active connections) but because Micro's 60 connections are shared by
-- PostgREST (~20), Storage (~15) and Auth, and the requests queued for them. `inline` additionally
-- downloaded every text file from storage, exhausting Storage's share (`429 Too many connections`,
-- SQEM-481) and losing files.
--
-- 1. `workspace_file_texts` — the text of a text context file, stored once.
-- 2. `library_access_sets()` — the three access sets the library reader needs, in ONE call.

-- ── 1. Stored file text ─────────────────────────────────────────────────────────────────────────
--
-- ⛔ A SEPARATE TABLE, not a column on `workspace_files`, and that is the point: the app reads
-- `workspace_files` with `select('*')`, so a text column would ship every file's full text to every
-- browser on every page load (6.3 MB on production). Revoking the column from clients would break
-- `select('*')` for tabs still running the old bundle. A table clients cannot see at all avoids both.
--
-- ⚠️ Correct only because a file's bytes never change after upload (no replace path; `storage_path`
-- not client-writable since SQEM-492; no UPDATE policy on the bucket) — the same premise as
-- `workspace_files.preview` (SQEM-481). If a replace path is ever built, it must delete this row.
-- Filled by the edge functions (service role) on first read; deleted with the file.
create table if not exists public.workspace_file_texts (
  file_id      uuid primary key references public.workspace_files(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content      text not null,
  created_at   timestamptz not null default now()
);

comment on table public.workspace_file_texts is
  'SQEM-500 — server-only copy of a text context file''s content, so library reads need no storage download. Filled on first read by the edge functions. No client access (RLS on, no policies).';

alter table public.workspace_file_texts enable row level security;
revoke all on public.workspace_file_texts from anon, authenticated;

-- ── 2. The reader's access sets in one call ──────────────────────────────────────────────────────
--
-- Replaces four PostgREST requests (two RPCs and two table reads) with one. ⛔ The rules are NOT
-- re-stated here: templates and personas come from the existing `mcp_accessible_*` functions, which
-- stay the single source for MCP access. The file set is the SQEM-291 rule that used to live in
-- `createLibraryReader`: files attached to a template the caller may open, plus files they uploaded
-- (mirrors `can_access_file()`).
--
-- `templates` carries the title as well, so `get_template(name: …)` resolves the name in memory
-- instead of reading every title in the workspace again.
create or replace function public.library_access_sets(p_workspace_id uuid, p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with t as (
    select p.id, p.title, p.context_file_ids
    from public.prompts p
    where p.workspace_id = p_workspace_id
      and p.id in (select id from public.mcp_accessible_template_ids(p_workspace_id, p_user_id))
  )
  select jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title)) from t), '[]'::jsonb),
    'personas',  coalesce((select jsonb_agg(id) from public.mcp_accessible_persona_ids(p_workspace_id, p_user_id)), '[]'::jsonb),
    'files',     coalesce((select jsonb_agg(distinct fid) from (
                   select unnest(context_file_ids) as fid from t
                   union
                   select f.id from public.workspace_files f
                   where f.workspace_id = p_workspace_id and f.created_by = p_user_id
                 ) s), '[]'::jsonb)
  );
$$;

comment on function public.library_access_sets(uuid, uuid) is
  'SQEM-500 — templates (id, title), personas and readable files for one person in one workspace, for the library reader (MCP + Chat). Delegates to mcp_accessible_template_ids / mcp_accessible_persona_ids; the file rule mirrors can_access_file(). Service role only.';

-- A SECURITY DEFINER function that answers "what may person X see" for any X must not be callable by
-- a client: it would let anyone ask about anyone.
revoke all on function public.library_access_sets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.library_access_sets(uuid, uuid) to service_role;

-- ── Self-check ───────────────────────────────────────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  if has_function_privilege('authenticated', 'public.library_access_sets(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.library_access_sets(uuid, uuid)', 'execute') then
    raise exception 'SQEM-500: library_access_sets is callable by a client role';
  end if;
  if has_table_privilege('authenticated', 'public.workspace_file_texts', 'select')
     or has_table_privilege('anon', 'public.workspace_file_texts', 'select') then
    raise exception 'SQEM-500: workspace_file_texts is readable by a client role';
  end if;
  -- An unknown workspace yields three empty arrays, not NULL — the reader treats a missing key as
  -- "nothing accessible", and this proves the shape it relies on.
  r := public.library_access_sets(gen_random_uuid(), gen_random_uuid());
  if r is null or r->'templates' <> '[]'::jsonb or r->'personas' <> '[]'::jsonb or r->'files' <> '[]'::jsonb then
    raise exception 'SQEM-500: library_access_sets returned an unexpected shape: %', r;
  end if;
end $$;
