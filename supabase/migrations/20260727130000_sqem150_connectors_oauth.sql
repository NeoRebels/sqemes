-- SQEM-150 — Connectors 1b: OAuth-connector columns on workspace_connectors.
--
-- OAuth connectors (Google/Gmail) mint a short-lived access token + a long-lived refresh token, so
-- we store the refresh token + the access-token expiry and refresh before each use. Manual (1a)
-- connectors leave these null. Additive & non-destructive.

alter table public.workspace_connectors
  add column if not exists provider              text,          -- 'manual' (1a) | 'google' (Gmail)
  add column if not exists refresh_token_encrypted text,        -- AES-GCM; OAuth connectors only
  add column if not exists token_expires_at       timestamptz;  -- access-token expiry (refresh before use)
