-- ============================================================
-- SQEM-311 — a workspace can choose which model does its authoring
-- ============================================================
--
-- Enhance, Generate description, both wizards, "Adapt to brand" and the website analysis all called
-- `firstTextModelId()`: **the first entry in `AVAILABLE_MODELS` whose provider has a key.** A
-- workspace with three provider keys got one of them and could neither see which nor change it,
-- except by deleting keys.
--
-- ⚠️ **That order was never a decision.** `AVAILABLE_MODELS` is sorted by provider (SQEM-278), not by
-- suitability for writing. The behaviour was an accident of list order that nothing described.
--
-- Nullable, and null keeps meaning exactly what it means today: pick automatically. **The automatic
-- path is not replaced, it becomes the fallback** — which matters because three separate things can
-- invalidate a stored choice: the model is retired from the catalogue, the provider's key is
-- removed, or the workspace has no key at all and runs on funded credits. In all three the column
-- still holds a value; only the resolver decides it does not apply.
--
-- ⛔ **No foreign key, no check constraint, and that is deliberate.** The set of valid ids lives in
-- `constants.ts` and changes with every model release. A constraint here would turn a model
-- retirement into a failing write on a table nobody was editing — and it would have to be migrated
-- in lockstep with a TypeScript file. The resolver validates instead, where the catalogue already is.
--
-- Self-host benefits more than Cloud: it is BYOK-only, so there is no funded fallback, and an
-- operator has usually chosen one provider on purpose.

alter table public.workspaces
  add column if not exists authoring_model_id text;

comment on column public.workspaces.authoring_model_id is
  'SQEM-311 — model id used for AI authoring (enhance, descriptions, wizards, brand adaptation). '
  'Null = pick the first text model with a configured key. Validated in the app against '
  'AVAILABLE_MODELS, not by a constraint: the catalogue changes with model releases.';

-- ⛔ **The grant is not optional, and forgetting it fails silently in the shape of success.**
--
-- SQEM-109 replaced blanket UPDATE on `public.workspaces` with **column-level** grants, so a new
-- settings column is unwritable by the client until it is named here — the row policy passes, the
-- request reaches the table, and Postgres answers `permission denied for table workspaces`. The UI
-- shows a toast and the value never lands.
--
-- ⚠️ **This has already happened once**: SQEM-142 added `default_template_access` and missed the
-- grant; SQEM-151 existed solely to add the line below for that column. The trap was written down
-- in `pm/DOCUMENTATION.md` in the source repository afterwards, which is the only reason it was
-- caught this time — **while
-- reading that file to update it for this ticket.** A note in a document is not overhead.
--
-- RLS still governs *which* rows (admin/editor of the workspace); the grant governs which columns.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'authoring_model_id'
  ) THEN
    EXECUTE 'GRANT UPDATE (authoring_model_id) ON public.workspaces TO authenticated';
  END IF;
END $$;
