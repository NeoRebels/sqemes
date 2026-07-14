-- ============================================================
-- Rate limit counters (replaces Deno KV which is unavailable
-- in Supabase Edge Functions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  workspace_id uuid NOT NULL,
  window_key   bigint NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, window_key)
);

-- Atomically increment counter and return whether the request is allowed.
-- Also cleans up windows older than 2 minutes to keep the table small.
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  ws_id      uuid,
  window_key bigint,
  rate_limit integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO rate_limit_counters (workspace_id, window_key, count)
  VALUES (ws_id, window_key, 1)
  ON CONFLICT (workspace_id, window_key)
  DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO new_count;

  -- Clean up stale windows (older than 2 minutes)
  DELETE FROM rate_limit_counters
  WHERE window_key < (EXTRACT(EPOCH FROM NOW()) / 60)::bigint - 2;

  RETURN new_count <= rate_limit;
END;
$$;
