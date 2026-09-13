import React from 'react';

/**
 * SQEM-384 — the page header, once.
 *
 * ⛔ This markup existed four times — Templates, Personas, Files, Marketplace — copied verbatim, and
 * the copies had already drifted (Files put its button straight into the flex row, the others wrapped
 * theirs). When SQEM-384 lengthened the Personas subtitle, the text block — which had no width of its
 * own — pushed the buttons until "Persona Wizard" wrapped onto two lines. Four copies would have
 * needed four fixes, and the fifth page would have copied the broken one.
 *
 * **The split is 50/50 from `sm` up** (owner's decision, 2026-09-12): the text may take half, the
 * actions take half, right-aligned. `sm:whitespace-nowrap` on the actions wrapper is inherited by
 * every button label inside it, so a label never wraps — when the buttons need more than half, the
 * text yields (`min-w-0`), never the buttons.
 *
 * ⚠️ Below `sm` the actions row WRAPS (`flex-wrap`) and the labels still never do. The first cut
 * left `nowrap` off on phones to keep three buttons inside the viewport — and got three buttons
 * with two-line labels instead (owner's screenshots, 2026-09-12). A second row of buttons is fine;
 * a label broken in half is not.
 *
 * `actions` may be `false`/`null` (a `canEdit &&` guard) — then no actions column is rendered and
 * the text keeps its half; the header does not stretch to fill it, which is the same look as before.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 md:mb-10 gap-4">
      <div className="sm:w-1/2 min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">{title}</h1>
        {subtitle && <p className="text-slate-500 dark:text-slate-400 mt-2">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-1/2 sm:justify-end whitespace-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
}
