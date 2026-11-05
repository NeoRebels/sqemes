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
 * with two-line labels instead (seen 2026-09-12). A second row of buttons is fine;
 * a label broken in half is not.
 *
 * `actions` may be `false`/`null` (a `canEdit &&` guard) — then no actions column is rendered and
 * the text keeps its half; the header does not stretch to fill it, which is the same look as before.
 *
 * ⛔ **SQEM-630/632 — the split follows the HEADER's width, not the window's.** It used to start at `sm`
 * (640 px window) with the actions on one row (`sm:flex-nowrap`). From `md` the sidebar takes ~16rem,
 * so at ~1040 px the Playbooks header was ~720 px wide, half of it ~360 px, and three nowrap buttons
 * (~450 px) ran left over the subtitle. Now the wrapper is a size container and the 50/50 row starts
 * at 56rem of HEADER width — room for three buttons beside half the text; below it the text sits on
 * top at full width and the actions below. The action row may still wrap (`flex-wrap` everywhere);
 * a label still never does. Tailwind 3.4 writes the query as an arbitrary variant, no plugin.
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
    <div className="[container-type:inline-size] mb-8 md:mb-10">
    <div className="flex flex-col [@container(min-width:56rem)]:flex-row [@container(min-width:56rem)]:items-end justify-between gap-4">
      <div className="[@container(min-width:56rem)]:w-1/2 min-w-0">
        {/* SQEM-547 — the one heading primitive gets the display face (Bricolage, semibold — its bold is heavy at 30px). */}
        <h1 className="font-display text-2xl md:text-3xl font-semibold text-ink-strong tracking-tight">{title}</h1>
        {subtitle && <p className="text-ink-muted mt-2">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 w-full [@container(min-width:56rem)]:w-1/2 [@container(min-width:56rem)]:justify-end whitespace-nowrap">
          {actions}
        </div>
      )}
    </div>
    </div>
  );
}
