-- ============================================================
-- SQEM-275 — carry stored model preferences to the new Anthropic ids
-- ============================================================
--
--   claude-opus-4-8   → claude-opus-5
--   claude-sonnet-4-6 → claude-sonnet-5
--
-- `constants.ts` no longer offers the old ids. Without this, a template that names one points at a
-- model the picker cannot show: the selection renders empty, and if it is still sent, it fails at the
-- provider the moment Anthropic retires the id — at run time, in front of the person using it.
--
-- ============================================================
-- ⚠️ `chat_messages.model` IS DELIBERATELY NOT TOUCHED
-- ============================================================
--
-- The distinction is the whole point of this migration, and it is easy to get wrong by being
-- thorough:
--
--   * `prompts.model` and `chat_sessions.model` are **intentions about the future** — "run this with
--     that model". Carrying them forward is what the owner would want done.
--
--   * `chat_messages.model` is a **fact about the past** — "*this* model produced *this* answer".
--     Rewriting it would claim Opus 5 wrote something Opus 4.8 wrote. The row would look tidier and
--     be false.
--
-- The same reasoning governs `prompts.ai_generated_at` in SQEM-265, which is nullable and never
-- backfilled for exactly this reason: a record of what happened is not a field to be normalised.
--
-- **If a future rename tempts someone to "finish the job" here, that is the trap.**

UPDATE public.prompts
   SET model = 'claude-opus-5'
 WHERE model = 'claude-opus-4-8';

UPDATE public.prompts
   SET model = 'claude-sonnet-5'
 WHERE model = 'claude-sonnet-4-6';

UPDATE public.chat_sessions
   SET model = 'claude-opus-5'
 WHERE model = 'claude-opus-4-8';

UPDATE public.chat_sessions
   SET model = 'claude-sonnet-5'
 WHERE model = 'claude-sonnet-4-6';
