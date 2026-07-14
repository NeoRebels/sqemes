-- Enable RLS on rate_limit_counters.
-- This table is internal-only and accessed exclusively via the
-- check_and_increment_rate_limit() SECURITY DEFINER function, which bypasses
-- RLS. No policies are added, so direct client access is denied.

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
