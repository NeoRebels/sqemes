-- SQEM-583 — Stop for a chat answer that runs in the background.
--
-- The answer runs in EdgeRuntime.waitUntil() after the HTTP response, so the browser cannot reach it.
-- Stop inserts one row here; chat-message looks for it every two seconds (service role), aborts its
-- provider requests and deletes the row (`_shared/chatCancel.ts`).
--
-- ⛔ Insert-only for clients, and only a row carrying their own id. No select, update or delete: the
-- table says nothing to anybody but the job that owns the id. A job id is a random UUID the client
-- generated for this one answer; the job also checks user_id, so knowing someone's job id is not
-- enough to stop their answer.
--
-- Rows the job never sees (Stop pressed after the answer had finished) are tiny and harmless; they
-- carry created_at so they can be swept if they ever matter.

create table public.chat_job_cancellations (
  job_id     uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.chat_job_cancellations enable row level security;

create policy chat_job_cancellations_insert on public.chat_job_cancellations
  for insert to authenticated
  with check (user_id = auth.uid());

revoke all on public.chat_job_cancellations from anon, authenticated;
grant insert (job_id) on public.chat_job_cancellations to authenticated;

comment on table public.chat_job_cancellations is
  'SQEM-583 — Stop requests for running chat answers. Insert-only for clients (own user_id, job_id column only); read and deleted by chat-message with the service role.';
