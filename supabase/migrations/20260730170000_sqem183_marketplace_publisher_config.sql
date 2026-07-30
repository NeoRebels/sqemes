-- SQEM-183 — self-host publisher token, stored AES-GCM-encrypted. Single-row, **service-role only**:
-- RLS is enabled with NO policies, so no browser/user role can read or write it. Only the api-sidecar
-- reaches it via the service role (which bypasses RLS) to set/read the ciphertext. Inert on Cloud
-- (Cloud users publish directly; this row is never populated there).
create table if not exists public.marketplace_publisher_config (
  id              integer primary key default 1 check (id = 1),
  token_encrypted text,
  updated_at      timestamptz not null default now()
);

alter table public.marketplace_publisher_config enable row level security;
-- No policies on purpose → deny all except the service role.
