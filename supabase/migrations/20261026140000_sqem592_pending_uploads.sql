-- SQEM-592 — a binary upload over MCP keeps the name it was announced with, folders included.
--
-- `create_upload_url` puts the bytes under a storage key with `/` defused to `_` (SQEM-111/237), and
-- `finalize_upload` used to name the `workspace_files` row after that key. The original name — and
-- with it the folder an Agent Skill needs (`design-system/fonts/x.woff2`, SQEM-236) — was gone by
-- then. This table carries the name across the PUT that happens in between.
--
-- ⛔ Service role only: RLS on, no policies, no grants. A row says nothing to anybody but the
-- finalize_upload call that consumes it.
--
-- Rows of uploads that are never finalised are tiny; finalize_upload sweeps those older than a day.

create table public.pending_uploads (
  file_id      uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now()
);

alter table public.pending_uploads enable row level security;

revoke all on public.pending_uploads from anon, authenticated;

comment on table public.pending_uploads is
  'SQEM-592 — the name a create_upload_url call announced, read and deleted by finalize_upload. Service role only.';
