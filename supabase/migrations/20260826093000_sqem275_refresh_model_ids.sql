-- ============================================================
-- SQEM-275 — carry stored model preferences through the list refresh
-- ============================================================
--
-- `AVAILABLE_MODELS` went from 34 entries to 25: the GPT-5.6 family replaced the 5.2/5.3 line,
-- `gemini-3.7-flash` and `gemini-3.5-flash-lite` replaced the deprecated 2.5 generation, `grok-4.6`
-- replaced `grok-4.20`, and several Gemini previews reached stable ids.
--
-- ============================================================
-- ⚠️ ONLY RENAMES ARE MIGRATED. SUBSTITUTIONS ARE NOT.
-- ============================================================
--
-- The line matters more than the list, so it is stated before the statements:
--
--   * **A rename is the same model under a new id.** `gemini-3.1-flash-image-preview` and
--     `gemini-3.1-flash-image` are one model that left preview. Carrying a stored preference across
--     that is a **factual correction** — the person's choice is preserved exactly.
--
--   * **A substitution is a different model.** `o3` → `gpt-5.6-sol` would silently change what a
--     template produces. Nobody asked for that, and the person who set `o3` had a reason we cannot
--     read. Those rows are **left alone**: the picker shows nothing selected, the person chooses
--     again, and they know it happened.
--
-- Leaving a dangling value looks untidy and is the honest option. **Do not "finish" this migration
-- by mapping the rest to their nearest equivalent** — that is a guess about someone else's intent,
-- executed on their data, invisibly.
--
-- `chat_messages.model` is untouched for the reason given in the previous migration: it records
-- which model produced a given answer. That is a fact about the past, not a preference to update.

-- ── Preview → stable: the same model, a new id ────────────────────────────────
UPDATE public.prompts SET model = 'gemini-3.1-flash-image'
 WHERE model = 'gemini-3.1-flash-image-preview';
UPDATE public.chat_sessions SET model = 'gemini-3.1-flash-image'
 WHERE model = 'gemini-3.1-flash-image-preview';

UPDATE public.prompts SET model = 'gemini-3-pro-image'
 WHERE model = 'gemini-3-pro-image-preview';
UPDATE public.chat_sessions SET model = 'gemini-3-pro-image'
 WHERE model = 'gemini-3-pro-image-preview';

-- `gemini-3.1-flash-lite-preview` also reached stable, but the refreshed list carries
-- `gemini-3.5-flash-lite` in that role instead. Moving a preference from 3.1 to 3.5 would be a
-- substitution, not a rename — so it is deliberately absent here.

-- ── Everything else is deliberately NOT migrated ──────────────────────────────
--   gpt-5.2, gpt-5.3-chat-latest, gpt-5-mini, o3, dall-e-3, gpt-image-1, gpt-image-1-mini,
--   gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.5-pro, gemini-2.5-flash-image,
--   gemini-3-flash-preview, gemini-3.1-flash-lite-preview,
--   grok-4.20-0309-reasoning, grok-4-1-fast-reasoning, grok-3, grok-imagine-image
--
-- Each of these is a model that no longer appears in the picker. A row still naming one shows an
-- empty selection, which is exactly the signal the person needs in order to pick deliberately.
