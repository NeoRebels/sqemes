-- SQEM-064 — MCP connection scopes & expiry (increment 1)
-- Additive. Adds per-connection capability scopes + optional expiry to API keys,
-- and carrier columns on the OAuth auth codes (populated by mcp-oauth in a later
-- increment). Single-shot safe — old code ignores these columns and the new
-- mcp-server falls back to full scopes when `scopes` is null.

-- `sqemes_api_keys` was created out-of-band (it is NOT in the repo migration
-- history), so a database built purely from migrations — Supabase preview
-- branches, a fresh self-host — does not have it, and the ALTER below would fail
-- with "relation does not exist". Create it idempotently; on existing projects
-- (staging/prod) this is a no-op. (Its out-of-band RLS select/insert/delete
-- policies are not reproduced here — capturing the full definition for
-- from-scratch builds is tracked under SQEM-056 self-hosting readiness.)
CREATE TABLE IF NOT EXISTS public.sqemes_api_keys (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  key_hash     text        NOT NULL UNIQUE,
  key_prefix   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- API keys: granted capabilities + optional connection expiry.
-- The NOT NULL DEFAULT backfills every existing key to full access, so no
-- live integration changes behaviour.
ALTER TABLE public.sqemes_api_keys
  ADD COLUMN IF NOT EXISTS scopes     text[]      NOT NULL DEFAULT '{read,create,update,delete}'::text[],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- OAuth auth codes carry the scope + connection-lifetime the user picks on the
-- consent screen through to the issued key (wired up in the OAuth increment).
-- NOTE: `mcp_auth_codes.expires_at` already exists and is the code's own 5-min
-- TTL — the chosen connection lifetime is a separate column, `key_expires_at`.
ALTER TABLE public.mcp_auth_codes
  ADD COLUMN IF NOT EXISTS scopes         text[],
  ADD COLUMN IF NOT EXISTS key_expires_at timestamptz;
