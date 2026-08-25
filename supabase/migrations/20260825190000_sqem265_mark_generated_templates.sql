-- ============================================================
-- SQEM-265 — mark a template that an AI wrote, not a person
-- ============================================================
--
-- The gap named in `pm/DOCUMENTATION.md` → *Regulatory — EU AI Act Article 50*, and left open there
-- rather than buried: **the setup wizard generates whole templates and stores them with no marker
-- at all.** A generated template lands in `prompts` indistinguishable from one somebody typed, while
-- Article 50(2) asks providers of systems generating synthetic text to mark the output
-- machine-readably. No exemption was claimed for it in the classification table, so this was a real
-- hole, not an interpretation.
--
-- **Chat needed no equivalent** — `chat_messages` already carries `role` and `model`, which says
-- structurally that a system produced the content and names which one. Adding a column there would
-- have been a second source of truth for a fact the schema already states.
--
-- ⚠️ **Scope: the wizard, and deliberately not the editor.** `lib/wizardGeneration.ts` produces whole
-- templates — brand assistant, starter prompts, starter skills — and the person only picks which to
-- keep. That is generation. The editor's *Enhance* and *Generate description* work on text the person
-- wrote and are covered by the editing exemption in Article 50(2) ("assistive function for standard
-- editing **or** do not substantially alter the input data … or the semantics thereof"). Marking
-- those would claim less exemption than we have, and would also be wrong: after somebody rewrites a
-- generated draft, nothing in the row can tell you whose sentences survived.
--
-- Nullable with no default, so:
--   * every existing row stays NULL — we cannot know retroactively what was generated, and guessing
--     would put a false claim on somebody's own writing;
--   * NULL means "not known to be generated", not "written by a person". The distinction matters if
--     this is ever read as evidence.

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz;

COMMENT ON COLUMN public.prompts.ai_generated_at IS
  'SQEM-265 — set when the setup wizard created this template from AI output (EU AI Act Art. 50(2)). NULL means not known to be generated, not "written by a human". Never backfilled.';
