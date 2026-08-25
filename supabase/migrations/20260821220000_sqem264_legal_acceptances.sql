-- ============================================================
-- SQEM-264 — record who accepted which legal document, and when
-- ============================================================
--
-- Until now the product asked nobody to accept anything. The texts existed on the marketing site and
-- were therefore *in force*, but nothing in the app linked to them and nothing recorded agreement —
-- so if a customer ever disputed a term, there was no answer to "when did they accept it?".
--
-- **This table is the answer, and its shape follows from what it has to survive:**
--
-- * **One row per (user, document, version).** Not a column on `profiles`. A flag says "accepted"
--   and loses *which text* was accepted — and the whole point of a version is that the text changes.
--   The history is the evidence; overwriting it destroys exactly the thing being stored.
-- * **`accepted_at` is written by the database**, not the client. A timestamp a browser can choose is
--   not evidence.
-- * **No IP address, no user agent.** Both were considered and rejected: they are personal data with
--   no consent purpose of their own, and Article 5(1)(c) does not care that a column is cheap. The
--   authenticated user id already identifies the person beyond doubt.
--
-- ⚠️ **Deliberately no unique constraint across (user_id, document) — only across all three columns.**
-- Accepting v2 must not erase the record of accepting v1. Re-accepting the *same* version is the only
-- thing that collapses, which is what `on conflict do nothing` in the client relies on.
--
-- **Why this ships before the texts do.** `lib/legal.ts` starts with every version set to `null`,
-- which means "not published yet" and gates nothing — so this migration is inert on the day it lands
-- and activates by changing one constant. The alternative, shipping table and gate together on the
-- day the texts go live, puts a schema change and a blocking screen in the same deploy, on the day
-- there is least room to be wrong.

create table if not exists public.legal_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy')),
  version     text not null check (length(version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

comment on table public.legal_acceptances is
  'SQEM-264 — one row per user per document version accepted. Append-only in practice: never update a row to a new version, insert another one.';

create index if not exists legal_acceptances_user_idx
  on public.legal_acceptances (user_id);

alter table public.legal_acceptances enable row level security;

-- A person may read their own record and add to it. They may not change or remove it: a consent log
-- the subject can rewrite is not a log. Deletion happens only through `on delete cascade` when the
-- account itself goes — the record has no purpose once the contract's counterparty is gone.
create policy legal_acceptances_select_own on public.legal_acceptances
  for select using (auth.uid() = user_id);

create policy legal_acceptances_insert_own on public.legal_acceptances
  for insert with check (auth.uid() = user_id);
