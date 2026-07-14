-- SQEM-057 phase 1 — rename plan tiers Pro→Team, Plus→Business.
--
-- In-place enum value rename: every existing row keeps its value under the new
-- name (no column cast, no data migration). `Solo` is unchanged. Display and
-- internal ids now match the product names (Solo / Team / Business).
-- Precedent: 20260311000000_rename_starter_to_solo.sql (Starter→Solo).
ALTER TYPE public.plan_tier RENAME VALUE 'Pro' TO 'Team';
ALTER TYPE public.plan_tier RENAME VALUE 'Plus' TO 'Business';
