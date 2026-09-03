-- SQEM-331 — re-issue one table comment so the database says what the file says.
--
-- `20260903180000_sqem324_personas.sql` carried two pointers to an internal document that the public
-- export prunes: a dead link for every self-hoster. The owner approved editing that already-applied
-- migration (2026-09-03), which the repository conventions otherwise forbid.
--
-- ⛔ **Editing the file is not enough for the second one, and that is the whole reason this file
-- exists.** One of the two was a plain SQL comment — the file is the only place it lives. The other
-- is the *value* of `comment on table public.personas`, which is a real database object: a migration
-- that has already run does not run again, so the databases would have kept the old sentence while
-- the file claimed otherwise. A divergence nobody would ever look for is worse than the dead link
-- it replaced.
--
-- Idempotent and inert: it sets a comment, nothing else.

comment on table public.personas is
  'SQEM-324 — an orchestrator over templates: prose in `content`, routes in `persona_templates`. MCP-only; there is no Chat launch path, and that gap is a deliberate decision rather than an oversight.';
